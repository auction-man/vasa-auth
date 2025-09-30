import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const CRIIPTO_DOMAIN = process.env.CRIIPTO_DOMAIN!;
const CRIIPTO_CLIENT_ID = process.env.CRIIPTO_CLIENT_ID!;
const CRIIPTO_CLIENT_SECRET = process.env.CRIIPTO_CLIENT_SECRET!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.vasaauktioner.se'; // håll som .vasaauktioner.se
const FINALIZE_URL = process.env.FINALIZE_URL!; // https://auth.vasaauktioner.se/api/auth/finalize

// Vi kör standard Node-runtime (inte edge) → Buffer funkar fint
function decodeIdTokenPayload(idToken: string): any {
  const parts = idToken.split('.');
  if (parts.length < 2) throw new Error('Invalid id_token');
  const json = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(json);
}

function parseState(state?: string): { return?: string } {
  if (!state) return {};
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) || {};
  } catch {
    return {};
  }
}

function buildCookie(): string {
  // 30 dagar
  const maxAge = 60 * 60 * 24 * 30;
  // Viktigt: ej HttpOnly (frontend behöver läsa cookie), SameSite=Lax är korrekt för login-redirects
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

  if (!code) {
    return res.status(400).json({ error: 'missing_code' });
  }

  try {
    // 1) Byt code → tokens hos Criipto
    const tokenUrl = `https://${CRIIPTO_DOMAIN}/oauth2/token`;
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', FINALIZE_URL);
    // Client auth i body (alternativ: Basic Auth)
    body.set('client_id', CRIIPTO_CLIENT_ID);
    body.set('client_secret', CRIIPTO_CLIENT_SECRET);

    const tokenResp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!tokenResp.ok) {
      const errTxt = await tokenResp.text().catch(() => '');
      throw new Error(`token_exchange_failed: ${tokenResp.status} ${errTxt}`);
    }

    const tok = await tokenResp.json() as {
      id_token: string;
      access_token?: string;
      token_type?: string;
      expires_in?: number;
    };

    // 2) Plocka claims ur id_token
    const claims = decodeIdTokenPayload(tok.id_token);
    // Minimalt: sub (bankid-subject). Andra claims varierar, men namn/ssn kan finnas.
    const bankid_subject: string = claims.sub;
    const display_name: string | null =
      claims.name || claims['given_name'] || claims['custom:name'] || null;

    // Vanliga personnummer-claims från BankID via Criipto kan heta t.ex. "identity_number" eller liknande.
    // Vi använder "hash"-fältet i din DB – lägg det du har eller lämna null.
    const personal_number_hash: string | null =
      claims['identity_number'] || claims['cnp'] || claims['pid'] || null;

    if (!bankid_subject) throw new Error('missing_sub_claim');

    // 3) Upsert i Supabase (public.profiles)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Finns rad redan?
    const { data: existing, error: selErr } = await supabase
      .from('profiles')
      .select('id, bankid_subject')
      .eq('bankid_subject', bankid_subject)
      .maybeSingle();

    if (selErr) throw selErr;

    let firstTime = false;

    if (!existing) {
      // Insert första gången
      const { error: insErr } = await supabase.from('profiles').insert({
        bankid_subject,
        personal_number_hash: personal_number_hash ?? null,
        display_name: display_name ?? null,
        needs_contact_info: true,           // första gången → trigga onboarding
        last_login_at: new Date().toISOString(),
      });
      if (insErr) throw insErr;
      firstTime = true;
    } else {
      // Update befintlig
      const { error: updErr } = await supabase
        .from('profiles')
        .update({
          // Spara ev. ny affärsnyttig metadata men skriv inte över manuellt ifyllt namn om du inte vill
          display_name: display_name ?? undefined,
          last_login_at: new Date().toISOString(),
        })
        .eq('bankid_subject', bankid_subject);
      if (updErr) throw updErr;
    }

    // 4) Sätt session-cookie för frontend (läsbar i JS)
    res.setHeader('Set-Cookie', buildCookie());

    // 5) Redirecta tillbaka dit vi skulle
    const { return: returnUrl } = parseState(stateParam);
    const fallback = 'https://vasaauktioner.se/post-login';
    const target = new URL((returnUrl && typeof returnUrl === 'string') ? returnUrl : fallback);

    if (firstTime) target.searchParams.set('first', '1');

    // Klart
    res.status(302).setHeader('Location', target.toString()).end();
  } catch (e: any) {
    // Hjälpsam felsöknings-JSON vid problem
    res.status(500).json({
      error: 'finalize_error',
      message: e?.message || String(e),
      hint: 'Kolla CRIIPTO_* och SUPABASE_* miljövariabler + DB-schema.',
    });
  }
}
