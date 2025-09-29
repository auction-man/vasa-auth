export const config = { runtime: "edge" };

// Liten hjälp: säkert domain för kakan
const COOKIE_DOMAIN = ".vasaauktioner.se";
const COOKIE_NAME = "va_session";
// 20 min räcker bra (i sekunder)
const MAX_AGE = 20 * 60;

function safeParseState(state: string | null): string {
  if (!state) return "https://vasaauktioner.se/post-login";
  try {
    const json = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as { r?: string };
    const u = json?.r ?? "";
    const url = new URL(u);
    if (url.hostname === "vasaauktioner.se" || url.hostname.endsWith(".vasaauktioner.se")) {
      return url.toString();
    }
  } catch {}
  return "https://vasaauktioner.se/post-login";
}

// (Mock) byt “code” mot tokens hos Criipto här om/ när du vill verifiera ID Token server-side.
// För POC/flow testar vi endast redirect + cookie.
export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");

  // OBS: i produktion – verifiera "code" mot Criipto innan du sätter cookie.
  // const code = url.searchParams.get("code")

  // Sätt session-cookie som läses av /post-login
  const cookieParts = [
    `${COOKIE_NAME}=ok`,
    `Path=/`,
    `Domain=${COOKIE_DOMAIN}`,
    `Max-Age=${MAX_AGE}`,
    `SameSite=Lax`,
    `Secure`,
  ];
  const headers = new Headers();
  headers.append("Set-Cookie", cookieParts.join("; "));

  const returnUrl = safeParseState(state);
  headers.set("Location", returnUrl);
  return new Response(null, { status: 302, headers });
}
