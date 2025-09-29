// api/auth/start.ts
export const config = { runtime: 'edge' };

const CLIENT_ID = 'urn:vasaauktioner:prod';
const CRIIPTO_AUTH = 'https://vasaauktioner.criipto.id/oauth2/authorize';
const FINALIZE = 'https://auth.vasaauktioner.se/api/auth/finalize';

function isMobile(ua: string) {
  return /iphone|ipad|ipod|android|mobile/i.test(ua || '');
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const returnTo = url.searchParams.get('return') || 'https://vasaauktioner.se/post-login';

  // Desktop = QR, Mobil = samma enhet
  const ua = req.headers.get('user-agent') || '';
  const acr = isMobile(ua)
    ? 'urn:grn:authn:se:bankid:same-device'
    : 'urn:grn:authn:se:bankid:another-device';

  const state = crypto.randomUUID(); // enkelt state; vi kan lägga ID-lagring senare

  const authUrl = new URL(CRIIPTO_AUTH);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', FINALIZE);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid');
  authUrl.searchParams.set('prompt', 'login');
  authUrl.searchParams.set('acr_values', acr);
  authUrl.searchParams.set('ui_locales', 'sv');
  authUrl.searchParams.set('state', JSON.stringify({ state, returnTo }));

  return Response.redirect(authUrl.toString(), 302);
};
