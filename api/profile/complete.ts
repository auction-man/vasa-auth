// api/profile/complete.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || 'https://vasaauktioner.se';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function setCORS(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Vary', 'Origin');
}

function readCookie(req: VercelRequest, name: string): string | null {
  const raw = req.headers.cookie || '';
  const found = raw
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + '='));
  if (!found) return null;
  try {
    return decodeURIComponent(found.split('=').slice(1).join('='));
  } catch {
    return found.split('=').slice(1).join('=');
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Always send CORS
  setCORS(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    // 1) Läs BankID-subjektet från cookie 'va_sub'
    const bankid_subject = readCookie(req, 'va_sub');
    if (!bankid_subject) {
      return res.status(401).json({ error: 'missing_va_sub_cookie' });
    }

    // 2) Läs body
    const { email, phone, address, zip, city, accept_terms } = (req.body || {}) as {
      email?: string;
      phone?: string;
      address?: string;
      zip?: string;
      city?: string;
      accept_terms?: boolean;
    };

    // Kräv accepterade villkor
    if (accept_terms !== true) {
      return res.status(400).json({ error: 'terms_required' });
    }

    const now = new Date().toISOString();

    // 3) Spara i databasen (UPSERT på bankid_subject)
    const { error } = await supabase
      .from('profiles')
      .upsert(
        {
          bankid_subject,
          email: email ?? null,
          phone: phone ?? null,
          address: address ?? null,
          zip: zip ?? null,
          city: city ?? null,
          accept_terms: true,
          needs_contact_info: false,
          updated_at: now,
        },
        { onConflict: 'bankid_subject' }
      );

    if (error) {
      console.error('Supabase upsert error:', error);
      return res.status(500).json({ error: 'db_upsert_failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('Unhandled error in /api/profile/complete:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
