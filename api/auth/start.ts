// Skickar användaren till Criipto authorize med state={return:url}
const CRIIPTO_DOMAIN = process.env.CRIIPTO_DOMAIN!;
const CRIIPTO_CLIENT_ID = process.env.CRIIPTO_CLIENT_ID!;
const FINALIZE_URL = process.env.FINALIZE_URL!; // ex: https://auth.vasaauktioner.se/api/auth/finalize

export default async function handler(req: any, res: any) {
  try {
    const returnUrl =
      typeof req.query.return === 'string'
        ? req.query.return
        : 'https://vasaauktioner.se/post-login';

    const state = Buffer.from(JSON.stringify({ return: returnUrl })).toString('base64url');

    const authorize = new URL(`https://${CRIIPTO_DOMAIN}/oauth2/authorize`);
    authorize.searchParams.set('client_id', CRIIPTO_CLIENT_ID);
    authorize.searchParams.set('redirect_uri', FINALIZE_URL);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', 'openid email');
    authorize.searchParams.set('state', state);

    res.statusCode = 302;
    res.setHeader('Location', authorize.toString());
    res.end();
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'start_error', message: e?.message || String(e) }));
  }
}
