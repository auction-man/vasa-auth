// api/auth/finalize.ts
export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  const url = new URL(req.url);

  if (url.searchParams.get("ping") === "1") {
    return new Response("finalize-pong", { status: 200 });
  }

  const ret = url.searchParams.get("return") || "https://vasaauktioner.se/post-login";

  // TEMP dev token – replaced by real token later
  const token = "dev-ok";

  // NOTE: no HttpOnly here (so /post-login's JS can read it)
  const cookie =
    `va_session=${encodeURIComponent(token)}; ` +
    `Domain=.vasaauktioner.se; Path=/; Secure; SameSite=Lax; Max-Age=2592000`;

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": cookie,
      "Location": ret,
      "Cache-Control": "no-store",
    },
  });
}
