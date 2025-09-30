// api/profile/complete.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// --- ENV ---
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || 'https://vasaauktioner.se';

// --- Helpers ---
function setCORS(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Vary', 'Origin'); // cache-säker
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function extractCookie(req: VercelRequest, name: string) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// --- Handler ---
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCORS(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    // 1) Auth via cookies (sätts av /api/auth/finalize)
    const hasSession = extractCookie(req, 'va_session') === 'ok';
    const bankid_subject = extractCookie(req, 'va_sub');

    if (!hasSession || !bankid_subject) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // 2) Body
    const { email, phone, address, zip, city, accept_terms } = (req.body || {}) as {
      email?: string;
      phone?: string;
      address?: string;
      zip?: string;
      city?: string;
      accept_terms?: boolean;
    };

    if (!accept_terms) {
      return res.status(400).json({ error: 'terms_required' });
    }

    // 3) Supabase (service role)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // 4) Uppdatera profilen
    const { data, error } = await supabase
      .from('profiles')
      .update({
        email: email ?? null,
        phone: phone ?? null,
        address: address ?? null,
        zip: zip ?? null,
        city: city ?? null,
        needs_contact_info: false,
        updated_at: new Date().toISOString(),
      })
      .eq('bankid_subject', bankid_subject)
      .select('id'); // få ut om något faktiskt uppdaterades

    if (error) {
      console.error('complete_update_error:', error);
      return res.status(500).json({ error: 'complete_error', message: error.message });
    }

    if (!data || data.length === 0) {
      // Ingen profil hittad för bankid_subject
      return res.status(404).json({ error: 'profile_not_found' });
    }

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('complete_uncaught_error:', e);
    return res.status(500).json({ error: 'complete_error', message: e?.message || String(e) });
  }
}
