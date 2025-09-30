import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const CRIIPTO_DOMAIN = process.env.CRIIPTO_DOMAIN!;
const CRIIPTO_CLIENT_ID = process.env.CRIIPTO_CLIENT_ID!;
const CRIIPTO_CLIENT_SECRET = process.env.CRIIPTO_CLIENT_SECRET!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.vasaauktioner.se';
const FINALIZE_URL = process.env.FINALIZE_URL!; // https://auth.vasaauktioner.se/api/auth/finalize

function decodePayload(idToken: string): any {
  const [, payload] = idToken.split('.');
  if (!payload) throw new Error('Invalid id_token');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function parseState(state?: string): { return?: string } {
  if (!state) return {};
  try { return JSON.parse(Buffer.from(state, 'base64url').toString('utf8')); }
  catch { return {}; }
}

function buildCookie(): string {
  const maxAge = 60 * 60 * 24 * 30; // 30 dagar
  return [
    `va_session=ok`,
    `Path=/`,
    `Domain=${COOKIE_DOMAIN}`,
    `Max-Age=${maxAge}`,
    `SameSite=Lax`,
    `Secure`,
  ].join('; ');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const stateParam = typeof req.query.state === 'string' ? req.query.state : undefined;
  if (!code) return res.status(400).json({ error: 'missing_code' });

  try {
    // 1) Code -> tokens (Criipto)
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', FINALIZE_URL);
    body.set('client_id', CRIIPTO_CLIENT_ID);
    body.set('client_secret', CRIIPTO_CLIENT_SECRET);

    const tokenResp = await fetch(`https://${CRIIPTO_DOMAIN}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
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

    // 3) Upsert i public.profiles
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });

    const { data: existing, error: selErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('bankid_subject', bankid_subject)
      .maybeSingle();
    if (selErr) throw selErr;

    let firstTime = false;

    if (!existing) {
      const { error: insErr } = await supabase.from('profiles').insert({
        bankid_subject,
        personal_number_hash: personal_number_hash ?? null,
        display_name: display_name ?? null,
        email: email ?? null,                 // email är nu tillåten att vara NULL
        needs_contact_info: true,             // triggar onboarding
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

    // 4) Cookie och redirect
    res.setHeader('Set-Cookie', buildCookie());

    const { return: returnUrl } = parseState(stateParam);
    const target = new URL((returnUrl && typeof returnUrl === 'string') ? returnUrl : 'https://vasaauktioner.se/post-login');
    if (firstTime) target.searchParams.set('first', '1');

    res.status(302).setHeader('Location', target.toString()).end();
  } catch (e: any) {
    res.status(500).json({
      error: 'finalize_error',
      message: e?.message || String(e),
      hint: 'Kolla CRIIPTO_*, SUPABASE_* och att profiles.email är nullable.',
    });
  }
}
