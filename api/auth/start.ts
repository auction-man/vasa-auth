// api/auth/start.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

function setCookieHeader(name: string, value: string, opts: Record<string, string | number | boolean> = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.Domain) parts.push(`Domain=${opts.Domain}`);
  if (opts.Path) parts.push(`Path=${opts.Path}`);
  if (opts["Max-Age"]) parts.push(`Max-Age=${opts["Max-Age"]}`);
  parts.push("Secure"); // we are on https only
  parts.push("SameSite=Lax");
  return parts.join("; ");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1) ping
  if (req.query.ping !== undefined) return res.status(200).send("start-pong");

  const returnUrl =
    typeof req.query.return === "string" && req.query.return
      ? req.query.return
      : "https://vasaauktioner.se/post-login";

  // 2) store intended return in a short-lived cookie on the auth subdomain
  const returnCookie = setCookieHeader("va_return", returnUrl, {
    Domain: "auth.vasaauktioner.se",
    Path: "/",
    "Max-Age": 300, // 5 minutes
  });

  // 3) CSRF state (also short-lived)
  const state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const stateCookie = setCookieHeader("va_oauth_state", state, {
    Domain: "auth.vasaauktioner.se",
    Path: "/",
    "Max-Age": 300,
  });

  // 4) build Criipto authorize URL
  const domain = process.env.CRIIPTO_DOMAIN!;        // e.g. vasaauktioner.criipto.id
  const clientId = process.env.CRIIPTO_CLIENT_ID!;   // e.g. urn:vasaauktioner:prod
  const redirectUri = process.env.CRIIPTO_REDIRECT!; // https://auth.vasaauktioner.se/api/auth/finalize

  // Most Criipto tenants accept /oauth2/authorize (new) and /authorize (old). Use oauth2.
  const authUrl = new URL(`https://${domain}/oauth2/authorize`);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid"); // minimal; we can extend later
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "login");
  // BankID profile (same-device). Adjust if you want QR, etc.
  authUrl.searchParams.set("acr_values", "urn:grn:authn:se:bankid:same-device");

  res.setHeader("Set-Cookie", [returnCookie, stateCookie]);
  res.status(302).setHeader("Location", authUrl.toString()).end();
}
