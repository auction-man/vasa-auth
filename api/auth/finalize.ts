export const config = { runtime: "edge" };

const APEX_POST_LOGIN = "https://vasaauktioner.se/post-login";

const COOKIE_NAME = "va_session";
const COOKIE_DOMAIN = ".vasaauktioner.se";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;  // 30 dagar

function setCookie(headers: Headers, value: string) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Domain=${COOKIE_DOMAIN}`,
    "Path=/",
    "Secure",
    "HttpOnly",
    "SameSite=None",
    `Max-Age=${COOKIE_MAX_AGE}`
  ];
  headers.append("Set-Cookie", parts.join("; "));
}

export default async function handler(req: Request) {
  const url = new URL(req.url);

  if (url.searchParams.get("ping") === "1") {
    return new Response("finalize-pong", { status: 200 });
  }

  if (url.searchParams.get("test") === "1") {
    const headers = new Headers();
    setCookie(headers, "dev-token");
    headers.set("Location", APEX_POST_LOGIN);
    return new Response(null, { status: 302, headers });
  }

  return new Response("Missing implementation (Step 3). If testing, add ?test=1", { status: 400 });
}
