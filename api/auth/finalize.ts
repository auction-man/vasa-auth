// api/auth/finalize.ts
// Edge Runtime + pratsam loggning. Sätter va_session på .vasaauktioner.se och redirectar.

export const config = { runtime: "edge" };

function text(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });
}

function cookieLine(
  name: string,
  value: string,
  opts: {
    domain?: string;
    path?: string;
    maxAge?: number;
    secure?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
    httpOnly?: boolean;
  } = {}
) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  parts.push(`Path=${opts.path ?? "/"}`);
  if (typeof opts.maxAge === "number") parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure ?? true) parts.push("Secure");
  if (opts.httpOnly) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

function parseCookies(hdr: string | null): Record<string, string> {
  const map: Record<string, string> = {};
  (hdr || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((c) => {
      const idx = c.indexOf("=");
      if (idx > 0) {
        const k = c.slice(0, idx).trim();
        const v = c.slice(idx + 1);
        map[k] = decodeURIComponent(v ?? "");
      }
    });
  return map;
}

function decideReturnUrl(retParam: string | null, retCookie: string | null): string {
  // Endast https://vasaauktioner.se/* tillåts
  const DEFAULT = "https://vasaauktioner.se/post-login";
  const candidate = retParam || retCookie || "";

  try {
    if (!candidate) return DEFAULT;

    // Tillåt absolut https-url till samma domän
    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
      const u = new URL(candidate);
      if (u.hostname.endsWith("vasaauktioner.se")) return u.toString();
      return DEFAULT;
    }

    // Tillåt relativ path som börjar med "/"
    if (candidate.startsWith("/")) {
      return `https://vasaauktioner.se${candidate}`;
    }

    // Allt annat: fallback
    return DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export default async function handler(req: Request): Promise<Response> {
  const t0 = Date.now();
  let url: URL | null = null;

  try {
    url = new URL(req.url);
    const params = url.searchParams;

    // 1) Snabb ping
    if (params.get("ping") === "1") {
      console.log("[finalize] ping");
      return text("finalize-pong");
    }

    // 2) Läs query + cookies (på auth-domänen)
    const code = params.get("code");
    const state = params.get("state");
    const retQ = params.get("return");

    const cookies = parseCookies(req.headers.get("cookie"));
    const stateCookie = cookies["va_oauth_state"] ?? null;
    const returnCookie = cookies["va_return"] ?? null;

    const returnUrl = decideReturnUrl(retQ, returnCookie);

    console.log("[finalize] incoming", {
      path: url.pathname,
      hasCode: !!code,
      hasState: !!state,
      stateCookie,
      returnQ: retQ,
      returnCookie,
      decidedReturn: returnUrl,
    });

    // 3) (Valfritt) varna vid state-mismatch – blockera inte flödet i dev
    if (state && stateCookie && state !== stateCookie) {
      console.warn("[finalize] STATE MISMATCH", { state, stateCookie });
    }

    // 4) Sätt sessionscookie på huvuddomänen + städa hjälp-cookies på auth
    const setCookies: string[] = [];

    // OBS: Inte HttpOnly – frontend läser cookien i JS
    setCookies.push(
      cookieLine("va_session", "ok", {
        domain: ".vasaauktioner.se",
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 dagar
        secure: true,
        sameSite: "Lax",
      })
    );

    // Städa hjälp-cookies på auth-subdomänen
    setCookies.push(cookieLine("va_oauth_state", "", { path: "/", maxAge: 0, secure: true, sameSite: "Lax" }));
    setCookies.push(cookieLine("va_return", "", { path: "/", maxAge: 0, secure: true, sameSite: "Lax" }));

    const headers = new Headers();
    setCookies.forEach((c) => headers.append("Set-Cookie", c));
    headers.set("Location", returnUrl);

    console.log("[finalize] redirect", { to: returnUrl, tookMs: Date.now() - t0 });

    return new Response(null, { status: 302, headers });
  } catch (err: any) {
    console.error("[finalize] ERROR", {
      message: err?.message ?? String(err),
      stack: err?.stack,
      tookMs: Date.now() - t0,
      url: url?.toString(),
    });

    return text(
      [
        "Auth finalize failed",
        "",
        JSON.stringify(
          {
            message: err?.message ?? String(err),
            stack: String(err?.stack || "").split("\n").slice(0, 5),
            url: url?.toString() ?? null,
          },
          null,
          2
        ),
      ].join("\n"),
      500
    );
  }
}
