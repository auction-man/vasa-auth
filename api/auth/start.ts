export const config = { runtime: "edge" };

const FALLBACK_RETURN = "https://vasaauktioner.se/post-login";
const BANKID_INIT = "https://vasaauktioner.se/functions/v1/bankid-init";

export default async function handler(req: Request) {
  const url = new URL(req.url);

  if (url.searchParams.get("ping") === "1") {
    return new Response("start-pong", { status: 200 });
  }

  const ret = url.searchParams.get("return") || FALLBACK_RETURN;

  const redirectUrl = new URL(BANKID_INIT);
  redirectUrl.searchParams.set("return", ret);

  return Response.redirect(redirectUrl.toString(), 302);
}
