// api/auth/finalize.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

// ----- helpers -----
const CRIIPTO_TOKEN_URL = 'https://vasaauktioner.criipto.id/oauth2/token';
const CLIENT_ID = 'urn:vasaauktioner:prod';

function redirect(res: VercelResponse, url: string, cookies: Array<string> = []) {
  cookies.forEach((c) => res.setHeader('Set-Cookie', c));
  res.status(302).setHeader('Location', url).end();
}

function cookie(name: string, value: string, opts: { domain?: string; path?: string; maxAge?: number; httpOnly?: boolean; sameSite?: 'Lax' | 'Strict' | 'None'; secure?: boolean } = {}) {
  const parts = [`${name}=${value}`];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) parts.push(`HttpOnly`);
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
  if (opts.secure ?? true) parts.push(`Secure`);
  return parts.join('; ');
}

async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
  });
  const res = await fetch(CRIIPTO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${t}`);
  }
  return res.json() as Promise<{ id_token: string }>;
}

function decodeJwt(idToken: string) {
  const [, payload] = idToken.split('.');
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  return JSON.parse(json) as {
    sub: string;
    personal_number?: string;
    name?: string;
    phone_number?: string;
    nonce?: string;
    acr?: string;
  };
}

async function ensureProfile(claims: { sub: string; personal_number?: string; name?: string; phone_number?: string }) {
  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!SUPABASE_URL || !SRK) throw new Error('Missing Supabase env');

  const headers = {
    apikey: SRK,
    Authorization: `Bearer ${SRK}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  // 1) Finns redan?
  const check = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=bankid_subject&bankid_subject=eq.${encodeURIComponent(claims.sub)}&limit=1`, {
    headers,
  });
  if (!check.ok) throw new Error(`profiles check failed ${check.status}`);
  const exists = (await check.json()) as Array<any>;
  const firstLogin = exists.length === 0;

  // 2) Upsert – sätt needs_contact_info vid första login
  //    Hasha personnummer på serversidan om du vill (här gör vi enkel maskning).
  const personal_number_hash = claims.personal_number ? `hash:${claims.personal_number.slice(0, 6)}******` : null;

  const upsertBody = [{
    bankid_subject: claims.sub,
    personal_number_hash,
    display_name: claims.name ?? null,
    phone: claims.phone_number ?? null,
    last_login_at: new Date().toISOString(),
    // sätts bara vid första gång
    needs_contact_info: firstLogin ? true : undefined,
  }];

  const upsert = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=bankid_subject`, {
    method: 'POST',
    headers,
    body: JSON.stringify(upsertBody),
  });
  if (!upsert.ok) {
    const t = await upsert.text();
    throw new Error(`profiles upsert failed ${upsert.status} ${t}`);
  }

  return { firstLogin };
}

// ----- handler -----
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { code, state, return: ret } = req.query as { code?: string; state?: string; return?: string };
    if (!code) return res.status(400).send('Missing code');

    // Din publicerade callback på denna function:
    const redirectUri = `https://auth.vasaauktioner.se/api/auth/finalize`;

    // 1) Byt code mot id_token
    const { id_token } = await exchangeCodeForTokens(code, redirectUri);

    // 2) Läs claims och säkerställ profil
    const claims = decodeJwt(id_token); // innehåller sub, ev. personal_number, name, phone_number
    const { firstLogin } = await ensureProfile({
      sub: claims.sub,
      personal_number: claims.personal_number,
      name: claims.name,
      phone_number: claims.phone_number,
    });

    // 3) Sätt session-cookie för huvuddomänen
    const cookies: string[] = [];
    cookies.push(cookie('va_session', 'ok', { domain: '.vasaauktioner.se', path: '/', maxAge: 60 * 60 * 24 * 7, httpOnly: false, sameSite: 'Lax', secure: true }));

    // 4) Skicka tillbaka – berätta om det var första login
    const fallback = 'https://vasaauktioner.se/post-login';
    const nextUrl = new URL((ret as string) || fallback);
    nextUrl.searchParams.set('first', firstLogin ? '1' : '0');

    return redirect(res, nextUrl.toString(), cookies);
  } catch (err: any) {
    console.error('finalize error', err);
    return res.status(500).send('Auth finalize failed');
  }
}
