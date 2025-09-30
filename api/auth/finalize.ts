// api/auth/finalize.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

/**
 * Miljövariabler som måste vara satta i Vercel Project → Settings → Environment Variables
 *
 * CRIIPTO_TOKEN_URL      t.ex. https://vasaauktioner.criipto.id/oauth2/token
 * CRIIPTO_CLIENT_ID      urn:vasaauktioner:prod
 * CRIIPTO_CLIENT_SECRET  <hemligt>
 * FINALIZE_URL           https://auth.vasaauktioner.se/api/auth/finalize  (måste matcha i Criipto)
 *
 * SUPABASE_URL           https://<project>.supabase.co
 * SUPABASE_SERVICE_ROLE  <service role jwt>
 *
 * COOKIE_DOMAIN          .vasaauktioner.se
 * COOKIE_MAX_AGE         1209600   (14 dagar, valfritt)
 */

const {
  CRIIPTO_TOKEN_URL,
  CRIIPTO_CLIENT_ID,
  CRIIPTO_CLIENT_SECRET,
  FINALIZE_URL,

  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,

  COOKIE_DOMAIN = '.vasaauktioner.se',
  COOKIE_MAX_AGE = '1209600',
} = process.env;

function decodeJwtPayload(jwt: string): any {
  const [, payload] = jwt.split('.');
  const json = Buffer.from(payload, 'base64').toString('utf8');
  return JSON.parse(json);
}

function sha256(input: string) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function setCookieHeaders(returnHostCookie = 'ok') {
  const cookies: string[] = [];

  // HttpOnly session-cookie som endast frontend kontrollerar existens av
  cookies.push(
    [
      `va_session=${encodeURIComponent(returnHostCookie)}`,
      `Domain=${COOKIE_DOMAIN}`,
      'Path=/',
      'Secure',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${COOKIE_MAX_AGE}`,
    ].join('; ')
  );

  return cookies;
}

function redirect(res: VercelResponse, to: string, extraCookies?: string[], extraLog?: any) {
  if (extraLog) console.log('[finalize] redirect meta:', extraLog);
  if (extraCookies?.length) res.setHeader('Set-Cookie', extraCookies);
  res.status(302).setHeader('Location', to).end();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 1) health/ping
    if (req.query.ping) {
      return res.status(200).send('finalize-pong');
    }

    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const explicitReturn = typeof req.query.return === 'string' ? String(req.query.return) : '';

    if (!code) {
      console.error('[finalize] missing code');
      return res.status(400).send('Auth finalize failed (missing code)');
    }

    // 2) default return URL
    const defaultReturn = explicitReturn || 'https://vasaauktioner.se/post-login';

    // 3) byt kod → token
    const tokenResp = await fetch(String(CRIIPTO_TOKEN_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: String(CRIIPTO_CLIENT_ID),
        client_secret: String(CRIIPTO_CLIENT_SECRET),
        redirect_uri: String(FINALIZE_URL),
      }),
    });

    if (!tokenResp.ok) {
      const txt = await tokenResp.text();
      console.error('[finalize] token exchange failed', tokenResp.status, txt);
      return res.status(500).send('Auth finalize failed');
    }

    const tokenJson = await tokenResp.json() as any;
    const idToken = tokenJson.id_token as string;
    if (!idToken) {
      console.error('[finalize] no id_token in response', tokenJson);
      return res.status(500).send('Auth finalize failed');
    }

    // 4) plocka claims ur id_token
    const claims = decodeJwtPayload(idToken);
    // typiska fält:
    // sub = bankid subject
    // ibland finns personnummer i olika claims; vi försöker hitta något vettigt
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

    // 5) kolla i Supabase om profilen redan finns
    const selectUrl = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
    selectUrl.searchParams.set('select', 'id,bankid_subject');
    selectUrl.searchParams.set('bankid_subject', `eq.${subject}`);

    const sbHeaders = {
      apikey: String(SUPABASE_SERVICE_ROLE),
      Authorization: `Bearer ${String(SUPABASE_SERVICE_ROLE)}`,
      'Content-Type': 'application/json',
    };

    const existedResp = await fetch(selectUrl.toString(), { headers: sbHeaders });
    const existed = existedResp.ok ? (await existedResp.json()) as any[] : [];

    let firstLogin = false;

    if (!Array.isArray(existed) || existed.length === 0) {
      // 6) skapa ny profil
      firstLogin = true;
      const upsertResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: {
          ...sbHeaders,
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify([{
          bankid_subject: subject,
          personal_number_hash: personalNumberHash,
          display_name: null,
          phone: null,
          needs_contact_info: true,
          last_login_at: new Date().toISOString(),
        }]),
      });

      if (!upsertResp.ok) {
        const txt = await upsertResp.text();
        console.error('[finalize] supabase upsert error', upsertResp.status, txt);
        // vi avbryter inte flödet — vi släpper in användaren ändå:
      } else {
        console.log('[finalize] profile created for subject', subject);
      }
    } else {
      // 7) uppdatera last_login_at
      const updateResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles?bankid_subject=eq.${encodeURIComponent(subject)}`, {
        method: 'PATCH',
        headers: {
          ...sbHeaders,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ last_login_at: new Date().toISOString() }),
      });
      if (!updateResp.ok) {
        const txt = await updateResp.text();
        console.warn('[finalize] supabase update warning', updateResp.status, txt);
      }
    }

    // 8) sätt va_session-cookie för huvuddomänen
    const cookies = setCookieHeaders('ok');

    // 9) bygg return-URL; lägg på first=1 om ny profil
    const ret = new URL(defaultReturn);
    if (firstLogin) {
      // PostLogin.tsx mappar first=1 → /profile?onboard=1
      ret.searchParams.set('first', '1');
    }

    return redirect(res, ret.toString(), cookies, { firstLogin, state, subject });

  } catch (err: any) {
    console.error('[finalize] ERROR', err?.message || err);
    return res.status(500).send('Auth finalize failed');
  }
}
