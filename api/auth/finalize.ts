import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// === Env (måste vara satta i Vercel) ===
const CRIIPTO_DOMAIN = process.env.CRIIPTO_DOMAIN!;
const CRIIPTO_CLIENT_ID = process.env.CRIIPTO_CLIENT_ID!;
const CRIIPTO_CLIENT_SECRET = process.env.CRIIPTO_CLIENT_SECRET!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.vasaauktioner.se';
const FINALIZE_URL = process.env.FINALIZE_URL!; // ex: https://auth.vasaauktioner.se/api/auth/finalize

// === Helpers ===
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

// Sätter både sessionscookie och en sub-cookie som backend kan läsa
function buildCookies(bankid_subject: string): string[] {
  const maxAge = 60 * 60 * 24 * 30; // 30 dagar
  const common = [`Path=/`, `Domain=${COOKIE_DOMAIN}`, `Max-Age=${maxAge}`, `SameSite=Lax`, `Secure`];
  return [
    ['va_session=ok', ...common].join('; '),
    [`va_sub=${encodeURIComponent(bankid_subject)}`, ...common].join('; ')
  ];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const stateParam = typeof req.query.state === 'string' ? req.query.state : undefined;
  if (!code) return res.status(400).json({ error: 'missing_code' });

  try {
    // 1) Hämta tokens via Criipto (OAuth token exchange)
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

    // 2) Dekoda ID token
    const claims = decodePayload(tok.id_token);
    const bankid_subject: string = claims.sub;
    const display_name: string | null =
      claims.name || claims.given_name || claims['custom:name'] || null;
    const personal_number_hash: string | null =
      claims.identity_number || claims.pid || claims.cnp || null;
    const email: string | null = claims.email || null;

    if (!bankid_subject) throw new Error('missing_sub_claim');

    // 3) Upsert i public.profiles med service_role
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
        email: email ?? null,                 // email är nullable i din DB nu
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

    // 4) Sätt cookies och redirecta
    res.setHeader('Set-Cookie', buildCookies(bankid_subject));
    const { return: returnUrl } = parseState(stateParam);
    const target = new URL((returnUrl && typeof returnUrl === 'string') ? returnUrl : 'https://vasaauktioner.se/post-login');
    if (firstTime) target.searchParams.set('first', '1');

    res.status(302).setHeader('Location', target.toString()).end();
  } catch (e: any) {
    res.status(500).json({
      error: 'finalize_error',
      message: e?.message || String(e),
      hint: 'Kontrollera CRIIPTO_*, SUPABASE_* env och att profiles.email är nullable.',
    });
  }
}
