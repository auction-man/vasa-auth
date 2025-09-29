// api/auth/finalize.ts
// Runtime: Node (Vercel default). Pratsam loggning för felsökning.

function text(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });
}

function json(data: any, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/** Bygger en Set-Cookie rad. */
function cookieLine(name: string, value: string, opts: {
  domain?: string; path?: string; maxAge?: number; secure?: boolean; sameSite?: "Lax"|"Strict"|"None"; httpOnly?: boolean;
} = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  parts.push(`Path=${opts.path ?? "/"}`);
  if (typeof opts.maxAge === "number") parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure ?? true) parts.push("Secure");
  if (opts.httpOnly) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

export default async function handler(req: Request): Promise<Response> {
  const startedAt = Date.now();
  try {
    const url = new URL(req.url);
    const q = Object.fromEntries(url.searchParams.entries());

    // 1) Ping
    if (url.searchParams.get("ping") === "1") {
      console.log("[finalize] ping=1");
      return text("finalize-pong");
    }

    // 2) Läs indata
    const code  = url.searchParams.get("code");     // från OIDC (Criipto)
    const state = url.searchParams.get("state");    // från OIDC (Criipto)
    const retQ  = url.searchParams.get("return");   // manuell override

    // Cookies på auth-domänen (hjälp-cookies från /start)
    const cookieHeader = req.headers.get("cookie") || "";
    const cookieMap: Record<string, string> = {};
    cookieHeader.split(";").forEach(c => {
      const [k, v] = c.split("=").map(s => s?.trim());
      if (k) cookieMap[k] = decodeURIComponent(v ?? "");
    });

    const stateCookie = cookieMap["va_oauth_state"] ?? null;
    const returnCookie = cookieMap["va_return"] ?? null;

    // 3) Bestäm return-URL
    const defaultReturn = "https://vasaauktioner.se/post-login";
    const returnUrl = (() => {
      try {
        // retQ kan vara absolut eller relativ – vi gör den absolut mot vasaauktioner.se
        if (retQ) return new URL(retQ, "https://vasaauktioner.se").toString();
        if (returnCookie) return new URL(returnCookie, "https://vasaauktioner.se").toString();
        return defaultReturn;
      } catch {
        return defaultReturn;
      }
    })();

    // 4) Logga allt viktigt
    console.log("[finalize] incoming", {
      path: url.pathname,
      query: q,
      hasCode: !!code,
      hasState: !!state,
      cookiesOnAuth: Object.keys(cookieMap),
      stateCookie,
      decidedReturn: returnUrl,
    });

    // 5) Valfri state-check (bara varna, stoppa inte flödet i dev)
    if (state && stateCookie && state !== stateCookie) {
      console.warn("[finalize] STATE MISMATCH", { state, stateCookie });
    }

    // 6) (Prod: här skulle man byta 'code' mot token och hämta subject från Id-token)
    // För nuvarande dev-setup räcker det att sätta sessionscookien och redirecta.

    const setCookies: string[] = [];

    // Sätt sessionscookie på huvuddomänen
    setCookies.push(
      cookieLine("va_session", "ok", {
        domain: ".vasaauktioner.se",
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 dagar
        secure: true,
        sameSite: "Lax",
        // OBS: inte HttpOnly – din frontend kollar cookien i JS
      })
    );

    // Städa bort hjälp-cookies på auth-subdomänen
    setCookies.push(cookieLine("va_oauth_state", "", { path: "/", maxAge: 0, secure: true, sameSite: "Lax" }));
    setCookies.push(cookieLine("va_return", "",      { path: "/", maxAge: 0, secure: true, sameSite: "Lax" }));

    const headers = new Headers();
    setCookies.forEach(c => headers.append("Set-Cookie", c));
    headers.set("Location", returnUrl);

    console.log("[finalize] redirecting", {
      to: returnUrl,
      setCookiesCount: setCookies.length,
      tookMs: Date.now() - startedAt,
    });

    return new Response(null, { status: 302, headers });
  } catch (err: any) {
    // 7) Fel – logga och visa allt vi kan
    console.error("[finalize] ERROR", {
      message: err?.message ?? String(err),
      stack: err?.stack,
    });

    // Tydlig text för dig i webbläsaren + JSON payload om du vill inspektera snabbt
    const body = [
      "Auth finalize failed",
      "",
      "— Copy/paste till mig vid behov —",
      JSON.stringify(
        {
          message: err?.message ?? String(err),
          stack: err?.stack?.split("\n").slice(0, 5),
        },
        null,
        2
      ),
    ].join("\n");

    return text(body, 500);
  }
}
