import type { VercelRequest, VercelResponse } from '@vercel/node';

const CRIIPTO_DOMAIN = process.env.CRIIPTO_DOMAIN!;           // t.ex. vasaauktioner.criipto.id
const CRIIPTO_CLIENT_ID = process.env.CRIIPTO_CLIENT_ID!;     // t.ex. urn:vasaauktioner:prod
const FINALIZE_URL = process.env.FINALIZE_URL!;               // https://auth.vasaauktioner.se/api/auth/finalize

// Hjälp: säkert base64 (utan padding)
function b64url(input: string) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Var ska vi tillbaka efter login?
    const ret = typeof req.query.return === 'string'
      ? req.query.return
      : 'https://vasaauktioner.se/post-login';

    // Lägg return i OIDC state (så finalize kan läsa den)
    const state = b64url(JSON.stringify({ return: ret }));

    const authorizeUrl = new URL(`https://${CRIIPTO_DOMAIN}/oauth2/authorize`);
    authorizeUrl.searchParams.set('client_id', CRIIPTO_CLIENT_ID);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'openid');
    authorizeUrl.searchParams.set('redirect_uri', FINALIZE_URL);
    authorizeUrl.searchParams.set('state', state);

    res.status(302).setHeader('Location', authorizeUrl.toString()).end();
  } catch (e: any) {
    res.status(500).json({ error: 'start_error', message: e?.message || String(e) });
  }
}
