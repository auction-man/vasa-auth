/* api/profile/complete.ts
 * Vercel Serverless Function (Node runtime)
 * - Strict CORS (always returned)
 * - OPTIONS support
 * - Reads cookies set by /api/auth/finalize (va_session, va_sub)
 * - Updates/creates row in public.profiles by bankid_subject
 */

import { createClient } from '@supabase/supabase-js'

// ---- ENV ----
const SUPABASE_URL = process.env.SUPABASE_URL as string
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE as string

// Frontend origin that is allowed to call this endpoint
const ALLOW_ORIGIN = 'https://vasaauktioner.se'

// ---- CORS helpers ----
function corsHeaders(origin?: string) {
  const o = origin && origin === ALLOW_ORIGIN ? origin : ALLOW_ORIGIN
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-requested-with',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  }
}

function send(res: any, status: number, body: unknown, origin?: string) {
  const headers = corsHeaders(origin)
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v as string))
  res.status(status).send(JSON.stringify(body))
}

// ---- Util ----
function parseCookies(header: string | undefined) {
  const out: Record<string, string> = {}
  if (!header) return out
  header.split(';').forEach(part => {
    const [k, ...rest] = part.trim().split('=')
    if (!k) return
    out[k] = decodeURIComponent(rest.join('=') || '')
  })
  return out
}

// ---- Handler ----
export default async function handler(req: any, res: any) {
  // Always attach CORS headers (even on errors)
  const origin = req.headers?.origin as string | undefined
  Object.entries(corsHeaders(origin)).forEach(([k, v]) => res.setHeader(k, v as string))

  // Fast path: preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return send(res, 405, { error: 'method_not_allowed' }, origin)
  }

  try {
    // 1) Validate session cookies
    const cookieHeader = req.headers?.cookie as string | undefined
    const cookies = parseCookies(cookieHeader)
    const hasSession = cookies['va_session'] === 'ok'
    const bankid_subject = cookies['va_sub'] || null

    if (!hasSession || !bankid_subject) {
      return send(res, 401, { error: 'unauthorized' }, origin)
    }

    // 2) Parse body
    let payload: any = {}
    try {
      payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    } catch {
      return send(res, 400, { error: 'invalid_json' }, origin)
    }

    const {
      email,
      phone,
      address,
      zip,
      city,
      accept_terms,
    } = payload || {}

    if (!accept_terms) {
      return send(res, 400, { error: 'terms_required' }, origin)
    }

    // 3) Supabase client (service role, no session persistence)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return send(res, 500, { error: 'server_misconfigured' }, origin)
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    })

    // 4) Try UPDATE; if 0 rows, INSERT
    const updateCols: Record<string, any> = {
      email: email ?? null,
      phone: phone ?? null,
      address: address ?? null,
      zip: zip ?? null,
      city: city ?? null,
      needs_contact_info: false,
      accept_terms: true,
      updated_at: new Date().toISOString(),
    }

    const { data: updData, error: updErr } = await supabase
      .from('profiles')
      .update(updateCols)
      .eq('bankid_subject', bankid_subject)
      .select('id')

    if (updErr) {
      // If update failed because row doesn't exist, try insert
      // (or if 0 rows were updated)
      if (!updData || updData.length === 0) {
        const insertCols = {
          bankid_subject,
          ...updateCols,
        }
        const { error: insErr } = await supabase.from('profiles').insert(insertCols)
        if (insErr) {
          return send(res, 500, { error: 'db_insert_error', message: insErr.message }, origin)
        }
      } else {
        return send(res, 500, { error: 'db_update_error', message: updErr.message }, origin)
      }
    } else {
      // If update succeeded but 0 rows affected, also try insert
      if (!updData || updData.length === 0) {
        const insertCols = {
          bankid_subject,
          ...updateCols,
        }
        const { error: insErr } = await supabase.from('profiles').insert(insertCols)
        if (insErr) {
          return send(res, 500, { error: 'db_insert_error', message: insErr.message }, origin)
        }
      }
    }

    // 5) Done
    return send(res, 200, { ok: true }, origin)
  } catch (e: any) {
    return send(res, 500, { error: 'complete_error', message: e?.message || String(e) }, origin)
  }
}
