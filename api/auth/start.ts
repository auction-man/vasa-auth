export const config = { runtime: 'edge' };

// TEMP: enkel "fake login" för att testa flödet.
// Sätter en va_session-cookie på apexdomänen och redirectar tillbaka.

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const ret =
    url.searchParams.get("return") ||
    "https://vasaauktioner.se/post-login";

  // 5 minuter (300 sekunder) räcker för test
  const cookie = [
    `va_session=dev-ok`,
    `Domain=.vasaauktioner.se`,
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=None`,
    `Max-Age=300`,
  ].join("; ");

  const headers = new Headers();
  headers.set("Set-Cookie", cookie);
  headers.set("Location", ret);

  return new Response(null, { status: 302, headers });
}
