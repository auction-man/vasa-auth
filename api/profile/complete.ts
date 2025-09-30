import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;

// Tillåt *.vasaauktioner.se (inkl. vasaauktioner.se, www.vasa..., auth.vasa...)
function isAllowedOrigin(origin?: string | null): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    return (
      host === 'vasaauktioner.se' ||
      host === 'www.vasaauktioner.se' ||
      host.endsWith('.vasaauktioner.se')
    );
  } catch {
    return false;
  }
}

function setCors(req: any, res: any) {
  const origin = req.headers.origin as string | undefined;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin!); // reflektera exakt origin
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // var generös med headers – vissa browsers skickar t.ex. "accept", "x-requested-with"
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Accept');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  // debug: berätta för loggarna vad vi såg
  res.setHeader('x-cors-origin', origin || 'none');
}

export default async function handler(req: any, res: any) {
  setCors(req, res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: 'method_not_allowed' }));
    }

    // --- Debug headers för Vercel Logs ---
    res.setHeader('x-debug-cookie-present', String(Boolean(req.headers.cookie)));
    res.setHeader('x-debug-ua', String(req.headers['user-agent'] || 'n/a'));

    // Läs cookies (måste skickas med credentials: 'include')
    const cookie = req.headers.cookie || '';
    const hasSession = /(?:^|;\s*)va_session=ok(?:;|$)/.test(cookie);
    const subMatch = cookie.match(/(?:^|;\s*)va_sub=([^;]+)/);
    const bankid_subject = subMatch ? decodeURIComponent(subMatch[1]) : null;

    if (!hasSession || !bankid_subject) {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: 'unauthorized' }));
    }

    // Body – Vercel tolkar JSON automatiskt vid content-type: application/json
    const { email, phone, address, zip, city, accept_terms } = req.body || {};
    if (!accept_terms) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: 'terms_required' }));
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const { error } = await supabase
      .from('profiles')
      .update({
        email: email ?? null,
        phone: phone ?? null,
        address: address ?? null,
        zip: zip ?? null,
        city: city ?? null,
        needs_contact_info: false,
      })
      .eq('bankid_subject', bankid_subject);

    if (error) throw error;

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: true }));
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'complete_error', message: e?.message || String(e) }));
  }
}
