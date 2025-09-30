// api/profile/complete.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;

// Din frontend-origins (måste vara exakt, inte "*")
const ALLOW_ORIGIN = 'https://vasaauktioner.se';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Vary', 'Origin'); // bra för caches
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  // Hantera preflight direkt
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    // Kräver va_session=ok + va_sub=<bankid_subject> på *.vasaauktioner.se
    const cookie = req.headers.cookie || '';
    const hasSession = /(?:^|;\s*)va_session=ok(?:;|$)/.test(cookie);
    const subMatch = cookie.match(/(?:^|;\s*)va_sub=([^;]+)/);
    const bankid_subject = subMatch ? decodeURIComponent(subMatch[1]) : null;

    if (!hasSession || !bankid_subject) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const { email, phone, address, zip, city, accept_terms } = (req.body ?? {}) as {
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
        // sätt gärna ev. flags här om ni vill trigga step 3 osv
      })
      .eq('bankid_subject', bankid_subject);

    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({
      error: 'complete_error',
      message: e?.message ?? String(e),
    });
  }
}
