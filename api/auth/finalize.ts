// api/auth/finalize.ts
export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  const url = new URL(req.url);

  // Health check
  if (url.searchParams.get("ping") === "1") {
    return new Response("finalize-pong", { status: 200 });
  }

  // Vart ska vi skicka tillbaka användaren när kakan är satt?
  const ret =
    url.searchParams.get("return") ||
    "https://vasaauktioner.se/post-login";

  // *** TILLFÄLLIG DEV-TOKEN ***
  // (När BankID/Criipto är inkopplat ersätter vi detta med riktig token.)
  const token = "dev-ok";

  // Sätt cookie på apex-domänen så att https://vasaauktioner.se kan läsa den
  // Viktigt: Domain=.vasaauktioner.se, Path=/, HttpOnly, Secure, SameSite=Lax
  const cookie =
    `va_session=${encodeURIComponent(token)}; ` +
    `Domain=.vasaauktioner.se; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`; // 30 dagar

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": cookie,
      "Location": ret,
      // (valfritt) för att undvika att mellanlager pillar
      "Cache-Control": "no-store",
    },
  });
}
