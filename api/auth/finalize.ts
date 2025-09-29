// api/auth/finalize.ts
export const config = { runtime: 'edge' };

export default async (req: Request) => {
  const url = new URL(req.url);

  // Hämta return-URL från state eller query
  let returnTo = 'https://vasaauktioner.se/post-login';
  const stateRaw = url.searchParams.get('state');
  try {
    if (stateRaw) {
      const parsed = JSON.parse(stateRaw);
      if (parsed?.returnTo) returnTo = parsed.returnTo;
    }
  } catch {}

  // Här skulle man normalt byta "code" mot tokens hos Criipto och
  // skapa en riktig session. För att få flödet att sitta:
  // 1) Sätt en test-session på apexdomänen (läsbar av JS)
  const cookie = [
    `va_session=ok`,
    `Path=/`,
    `Domain=vasaauktioner.se`, // <- viktigt: apexdomänen
    `Max-Age=86400`,
    `SameSite=Lax`,
    `Secure`,
  ].join('; ');

  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': cookie,
      Location: returnTo,
    },
  });
};
