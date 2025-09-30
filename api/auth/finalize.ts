import { createClient } from '@supabase/supabase-js';

const CRIIPTO_DOMAIN = process.env.CRIIPTO_DOMAIN!;
const CRIIPTO_CLIENT_ID = process.env.CRIIPTO_CLIENT_ID!;
const CRIIPTO_CLIENT_SECRET = process.env.CRIIPTO_CLIENT_SECRET!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.vasaauktioner.se';
const FINALIZE_URL = process.env.FINALIZE_URL!; // https://auth.vasaauktioner.se/api/auth/finalize

function decodePayload(idToken: string): any {
  const parts = idToken.split('.');
  if (parts.length < 2) throw new Error('Invalid id_token');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}
function parseState(state?: string): { return?: string } {
  if (!state) return {};
  try { return JSON.parse(Buffer.from(state, 'base64url').toString('utf8')); }
  catch { return {}; }
}
function buildCookies(bankid_subject: string): string[] {
  const maxAge = 60 * 60 * 24 * 30;
  const common = [`Path=/`, `Domain=${COOKIE_DOMAIN}`, `Max-Age=${maxAge}`, `SameSite=Lax`, `Secure`];
  return [
    ['va_session=ok', ...common].join('; '),
    [`va_sub=${encodeURIComponent(bankid_subject)}`, ...common].join('; '),
  ];
}

export default async function handler(req: any, res: any) {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const stateParam = typeof req.query.state === 'string' ? req.query.state : undefined;
  if (!code) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'missing_code' }));
  }

  try {
    // 1) Token exchange
    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    params.set('redirect_uri', FINALIZE_URL);
    params.set('client_id', CRIIPTO_CLIENT_ID);
    params.set('client_secret', CRIIPTO_CLIENT_SECRET);

    const tokenResp = await fetch(`https://${CRIIPTO_DOMAIN}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!tokenResp.ok) {
      const t = await tokenResp.text().catch(() => '');
      throw new Error(`token_exchange_failed: ${tokenResp.status} ${t}`);
    }
    const tok = await tokenResp.json() as { id_token: string };

    // 2) Claims
    const claims = decodePayload(tok.id_token);
    const bankid_subject: string = claims.sub;
    const display_name: string | null =
      claims.name || claims.given_name || claims['custom:name'] || null;
    const personal_number_hash: string | null =
      claims.identity_number || claims.pid || claims.cnp || null;
    const email: string | null = claims.email || null;
    if (!bankid_subject) throw new Error('missing_sub_claim');

    // 3) Upsert profil
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: existing, error: selErr } = await supabase
      .from('profiles').select('id').eq('bankid_subject', bankid_subject).maybeSingle();
    if (selErr) throw selErr;

    let firstTime = false;
    if (!existing) {
      const { error: insErr } = await supabase.from('profiles').insert({
        bankid_subject,
        personal_number_hash: personal_number_hash ?? null,
        display_name: display_name ?? null,
        email: email ?? null,
        needs_contact_info: true,
        last_login_at: new Date().toISOString(),
      });
      if (insErr) throw insErr;
      firstTime = true;
    } else {
      const { error: updErr } = await supabase
        .from('profiles')
        .update({
          display_name: display_name ?? undefined,
          email: email ?? undefined,
          last_login_at: new Date().toISOString(),
        })
        .eq('bankid_subject', bankid_subject);
      if (updErr) throw updErr;
    }

    // 4) Cookies + redirect via /post-login
    res.setHeader('Set-Cookie', buildCookies(bankid_subject));
    const { return: originalReturn } = parseState(stateParam);

    const target = new URL('https://vasaauktioner.se/post-login');
    if (originalReturn) target.searchParams.set('return', originalReturn);
    if (firstTime) target.searchParams.set('first', '1');

    res.statusCode = 302;
    res.setHeader('Location', target.toString());
    res.end();
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      error: 'finalize_error',
      message: e?.message || String(e),
      hint: 'Kontrollera CRIIPTO_*, SUPABASE_* env och att profiles.email är nullable.',
    }));
  }
}
