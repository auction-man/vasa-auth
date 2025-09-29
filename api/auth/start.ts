import type { VercelRequest, VercelResponse } from 'vercel';

function isMobile(ua: string) {
  // enkel men funkar bra här
  return /Android|iPhone|iPad|iPod/i.test(ua || '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const returnUrl =
    (typeof req.query.return === 'string' && req.query.return) ||
    'https://vasaauktioner.se/post-login';

  const ua = req.headers['user-agent'] || '';
  // Mobil => same-device (öppna BankID-appen)
  // Desktop => QR (lämna bort same-device)
  const acr = isMobile(ua)
    ? 'urn:grn:authn:se:bankid:same-device'
    : 'urn:grn:authn:se:bankid';

  const params = new URLSearchParams({
    client_id: 'urn:vasaauktioner:prod',
    redirect_uri: 'https://auth.vasaauktioner.se/api/auth/finalize',
    response_type: 'code',
    scope: 'openid',
    state: Math.random().toString(36).slice(2),
    prompt: 'login',
    acr_values: acr,
  });

  const authorizeUrl = `https://vasaauktioner.criipto.id/oauth2/authorize?${params.toString()}`;
  // spara returnUrl i en kortlivad cookie så finalize vet vart vi ska tillbaka
  res.setHeader(
    'Set-Cookie',
    `va_return=${encodeURIComponent(returnUrl)}; Path=/; Max-Age=300; Secure; SameSite=Lax`
  );
  res.redirect(authorizeUrl);
}
