// api/auth/finalize.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const {
  CRIIPTO_TOKEN_URL,
  CRIIPTO_CLIENT_ID,
  CRIIPTO_CLIENT_SECRET,
  FINALIZE_URL,

  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,

  COOKIE_DOMAIN = '.vasaauktioner.se',
  COOKIE_MAX_AGE = '1209600', // 14 dagar
} = process.env;

function decodeJwtPayload(jwt: string): any {
  const [, payload] = jwt.split('.');
  const json = Buffer.from(payload, 'base64').toString('utf8');
  return JSON.parse(json);
}
const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function setVaSessionCookie() {
  return [
    [
      `va_session=ok`,
      `Domain=${COOKIE_DOMAIN}`,
      'Path=/',
      'Secure',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${COOKIE_MAX_AGE}`,
    ].join('; '),
  ];
}

function redirect(res: VercelResponse, to: string, cookies?: string[], log?: any) {
  if (log) console.log('[finalize] redirect meta:', log);
  if (cookies?.length) res.setHeader('Set-Cookie', cookies);
  res.status(302).setHeader('Location', to).end();
}

function basicAuthHeader(id: string, secret: string) {
  const b64 = Buffer.from(`${id}:${secret}`).toString('base64');
  return `Basic ${b64}`;
}

function ok(v?: string) {
  return Boolean(v && typeof v === 'string' && v.trim().length > 0);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // --- Health/Debug ---
    if (req.query.ping) return res.status(200).send('finalize-pong');

    if (req.query.dbg) {
      // läcker inte hemligheter – visar bara "present: true/false"
      return res.status(200).json({
        env: {
          CRIIPTO_TOKEN_URL: ok(CRIIPTO_TOKEN_URL),
          CRIIPTO_CLIENT_ID: ok(CRIIPTO_CLIENT_ID),
          CRIIPTO_CLIENT_SECRET: ok(CRIIPTO_CLIENT_SECRET),
          FINALIZE_URL: ok(FINALIZE_URL),
          SUPABASE_URL: ok(SUPABASE_URL),
          SUPABASE_SERVICE_ROLE: ok(SUPABASE_SERVICE_ROLE),
          COOKIE_DOMAIN,
        },
      });
    }

    // --- Env validation (logga tydligt om något saknas) ---
    const missing: string[] = [];
    if (!ok(CRIIPTO_TOKEN_URL)) missing.push('CRIIPTO_TOKEN_URL');
    if (!ok(CRIIPTO_CLIENT_ID)) missing.push('CRIIPTO_CLIENT_ID');
    if (!ok(CRIIPTO_CLIENT_SECRET)) missing.push('CRIIPTO_CLIENT_SECRET');
    if (!ok(FINALIZE_URL)) missing.push('FINALIZE_URL');
    if (!ok(SUPABASE_URL)) missing.push('SUPABASE_URL');
    if (!ok(SUPABASE_SERVICE_ROLE)) missing.push('SUPABASE_SERVICE_ROLE');

    if (missing.length) {
      console.error('[finalize] Missing env vars:', missing);
      return res.status(500).send('Auth finalize failed (env)');
    }

    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const explicitReturn = typeof req.query.return === 'string' ? String(req.query.return) : '';

    if (!code) {
      console.error('[finalize] missing code');
      return res.status(400).send('Auth finalize failed (missing code)');
    }

    const defaultReturn = explicitReturn || 'https://vasaauktioner.se/post-login';

    // --- Token exchange mot Criipto ---
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: String(CRIIPTO_CLIENT_ID),
      // client_secret döljs i body OCH vi provar även Basic nedan
      client_secret: String(CRIIPTO_CLIENT_SECRET),
      redirect_uri: String(FINALIZE_URL),
    });

    let tokenResp = await fetch(String(CRIIPTO_TOKEN_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!tokenResp.ok) {
      // Prova igen med Basic-Auth (vissa IdP kräver detta)
      const body2 = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: String(FINALIZE_URL),
      });
      tokenResp = await fetch(String(CRIIPTO_TOKEN_URL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: basicAuthHeader(String(CRIIPTO_CLIENT_ID), String(CRIIPTO_CLIENT_SECRET)),
        },
        body: body2,
      });
    }

    if (!tokenResp.ok) {
      const txt = await tokenResp.text().catch(() => '');
      console.error('[finalize] token exchange failed', tokenResp.status, txt);
      return res.status(500).send('Auth finalize failed');
    }

    const tokenJson = (await tokenResp.json()) as any;
    const idToken = tokenJson.id_token as string;
    if (!idToken) {
      console.error('[finalize] no id_token in response', tokenJson);
      return res.status(500).send('Auth finalize failed');
    }

    // --- Claims ---
    const claims = decodeJwtPayload(idToken);
    const subject: string | undefined = claims.sub;
    const possiblePn =
      claims.personalNumber ||
      claims.ssn ||
      claims.pnr ||
      claims['https://claims.oidc.se/identity_number'] ||
      claims['https://bankid/ssn'];
    if (!subject) {
      console.error('[finalize] missing subject in id_token', claims);
      return res.status(500).send('Auth finalize failed');
    }
    const personalNumberHash = possiblePn ? sha256(String(possiblePn)) : null;

    // --- Supabase: check + create/update profile ---
    const sbHeaders = {
      apikey: String(SUPABASE_SERVICE_ROLE),
      Authorization: `Bearer ${String(SUPABASE_SERVICE_ROLE)}`,
      'Content-Type': 'application/json',
    };

    const selectUrl = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
    selectUrl.searchParams.set('select', 'id,bankid_subject');
    selectUrl.searchParams.set('bankid_subject', `eq.${subject}`);

    const existedResp = await fetch(selectUrl.toString(), { headers: sbHeaders });
    if (!existedResp.ok) {
      const txt = await existedResp.text().catch(() => '');
      console.error('[finalize] supabase select error', existedResp.status, txt);
      // vi släpper in ändå, men loggar
    }
    const existed = existedResp.ok ? ((await existedResp.json()) as any[]) : [];

    let firstLogin = false;

    if (!Array.isArray(existed) || existed.length === 0) {
      firstLogin = true;
      const upsertResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([
          {
            bankid_subject: subject,
            personal_number_hash: personalNumberHash,
            display_name: null,
            phone: null,
            needs_contact_info: true,
            last_login_at: new Date().toISOString(),
          },
        ]),
      });
      if (!upsertResp.ok) {
        const txt = await upsertResp.text().catch(() => '');
        console.error('[finalize] supabase upsert error', upsertResp.status, txt);
      } else {
        console.log('[finalize] profile created for', subject);
      }
    } else {
      const updateResp = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?bankid_subject=eq.${encodeURIComponent(subject)}`,
        {
          method: 'PATCH',
          headers: { ...sbHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify({ last_login_at: new Date().toISOString() }),
        }
      );
      if (!updateResp.ok) {
        const txt = await updateResp.text().catch(() => '');
        console.warn('[finalize] supabase update warning', updateResp.status, txt);
      }
    }

    // --- Cookie + redirect ---
    const cookies = setVaSessionCookie();
    const ret = new URL(defaultReturn);
    if (firstLogin) ret.searchParams.set('first', '1');

    return redirect(res, ret.toString(), cookies, { firstLogin, subject });

  } catch (err: any) {
    console.error('[finalize] ERROR', err?.message || err);
    return res.status(500).send('Auth finalize failed');
  }
}
