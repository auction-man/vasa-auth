export const config = { runtime: "edge" };

function b64url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function allowedReturn(u: string): string | null {
  try {
    const url = new URL(u);
    // Tillåt bara tillbaka till vasaauktioner.se (apex eller subdomäner)
    if (url.hostname === "vasaauktioner.se" || url.hostname.endsWith(".vasaauktioner.se")) {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const wanted = url.searchParams.get("return") ?? "";
  const returnUrl =
    allowedReturn(wanted) ?? "https://vasaauktioner.se/post-login";

  // Packa returnUrl i state så vi kan plocka ut den i /finalize
  const state = b64url(JSON.stringify({ r: returnUrl, t: Date.now() }));

  // Criipto authorize-URL (enda du ev. behöver justera är domain+client_id)
  const criipto = new URL("https://vasaauktioner.criipto.id/oauth2/authorize");
  criipto.searchParams.set("client_id", "urn:vasaauktioner:prod");
  criipto.searchParams.set("redirect_uri", "https://auth.vasaauktioner.se/api/auth/finalize");
  criipto.searchParams.set("response_type", "code");
  criipto.searchParams.set("scope", "openid");
  criipto.searchParams.set("state", state);
  criipto.searchParams.set("prompt", "login");
  // QR på desktop, app på mobil:
  criipto.searchParams.set("acr_values", "urn:grn:authn:se:bankid:same-device urn:grn:authn:se:bankid");

  return Response.redirect(criipto.toString(), 302);
}
