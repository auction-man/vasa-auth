// api/auth/finalize.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

function parseCookie(header?: string) {
  const out: Record<string, string> = {};
  (header || "").split(";").forEach(p => {
    const [k, ...rest] = p.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(rest.join("=") || "");
  });
  return out;
}
function cookieStr(name: string, value: string, opts: Record<string, string | number | boolean> = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.Domain) parts.push(`Domain=${opts.Domain}`);
  if (opts.Path) parts.push(`Path=${opts.Path}`);
  if (opts["Max-Age"]) parts.push(`Max-Age=${opts["Max-Age"]}`);
  parts.push("Secure");
  parts.push("SameSite=Lax");
  return parts.join("; ");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ping for sanity
  if (req.query.ping !== undefined) return res.status(200).send("finalize-pong");

  const cookies = parseCookie(req.headers.cookie);
  const givenState = String(req.query.state || "");
  const savedState = cookies["va_oauth_state"] || "";

  // take return from cookie; default to /post-login
  const ret = cookies["va_return"] || "https://vasaauktioner.se/post-login";

  // Clear temp cookies on auth subdomain
  const clrState = cookieStr("va_oauth_state", "", { Domain: "auth.vasaauktioner.se", Path: "/", "Max-Age": 0 });
  const clrReturn = cookieStr("va_return", "", { Domain: "auth.vasaauktioner.se", Path: "/", "Max-Age": 0 });

  // If state mismatch -> bounce back to /post-login without session
  if (!givenState || !savedState || givenState !== savedState) {
    res.setHeader("Set-Cookie", [clrState, clrReturn]);
    return res.status(302).setHeader("Location", ret).end();
  }

  // 🔒 Here we *should* exchange ?code for tokens at Criipto.
  // To get you moving, we set a temporary front-end readable cookie on the apex:
  const sessionCookie = cookieStr("va_session", "ok", {
    Domain: ".vasaauktioner.se",
    Path: "/",
    "Max-Age": 60 * 60 * 24 * 7, // 7 days demo
  });

  res.setHeader("Set-Cookie", [sessionCookie, clrState, clrReturn]);
  res.status(302).setHeader("Location", ret).end();
}
