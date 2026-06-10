import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../../../models/db.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";

// ── Google OAuth endpoints ────────────────────────────────────
const GOOGLE_AUTH_BASE  = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL  = "https://oauth2.googleapis.com/token";

// Google Ads API scope — grants full access to read campaigns,
// lead forms, and download lead submissions
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/adwords";

// ============================================================
// 1️⃣  GOOGLE OAUTH START
// Route: GET /api/google/oauth/start
//
// Browser-facing redirect — never returns a body.
// The frontend triggers it with:
//   window.location.href = BACKEND_URL + "/api/google/oauth/start?token=<access_token>"
//
// Why ?token= instead of a cookie?
//   The access_token cookie lives on the frontend domain (set via the
//   login proxy).  When the browser navigates directly to the backend
//   domain there is no cookie present, so the JWT must be passed as a
//   query param.
//
// Key differences from Meta OAuth:
//   • access_type: "offline"  →  Google returns a refresh_token so the
//     backend can silently refresh access forever (Meta uses long-lived
//     tokens differently).
//   • prompt: "consent"       →  Forces Google to always issue a fresh
//     refresh_token.  Without this, re-connecting gives an access_token
//     but NO refresh_token — and after 1 hour the integration breaks.
//   • scope is a full URL     →  "https://www.googleapis.com/auth/adwords"
//     (Meta uses short names like "pages_show_list")
// ============================================================
export const googleOAuthStart = async (
  req: FastifyRequest<{ Querystring: { token?: string } }>,
  reply: FastifyReply
) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
  const isProduction  = process.env.NODE_ENV === "production";

  // ── 1. Env guard ──────────────────────────────────────────
  const clientId    = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  req.log.info(
    { clientId: clientId ? "SET" : "MISSING", redirectUri: redirectUri ? "SET" : "MISSING" },
    "[google/oauth/start] env check"
  );

  if (!clientId || !redirectUri) {
    req.log.error("[google/oauth/start] FAIL: not_configured — missing env vars");
    return reply.redirect(
      `${FRONTEND_URL}/integrations?google_error=not_configured`
    );
  }

  // ── 2. JWT verification ───────────────────────────────────
  const rawToken = req.query.token;

  req.log.info(
    { tokenPresent: !!rawToken },
    "[google/oauth/start] token check"
  );

  if (!rawToken) {
    req.log.error("[google/oauth/start] FAIL: unauthorized — no ?token= in query");
    return reply.redirect(
      `${FRONTEND_URL}/integrations?google_error=unauthorized`
    );
  }

  let username: string;
  try {
    const decoded = jwt.verify(rawToken, process.env.JWT_SECRET!) as {
      username?: string;
      token_type?: string;
    };

    req.log.info(
      { token_type: decoded.token_type, username: decoded.username },
      "[google/oauth/start] JWT decoded"
    );

    if (decoded.token_type !== "access" || !decoded.username) {
      req.log.error(
        { token_type: decoded.token_type, hasUsername: !!decoded.username },
        "[google/oauth/start] FAIL: unauthorized — wrong token_type or missing username"
      );
      return reply.redirect(
        `${FRONTEND_URL}/integrations?google_error=unauthorized`
      );
    }

    username = decoded.username;
  } catch (jwtErr) {
    req.log.error({ err: jwtErr }, "[google/oauth/start] FAIL: unauthorized — JWT verify threw");
    return reply.redirect(
      `${FRONTEND_URL}/integrations?google_error=unauthorized`
    );
  }

  // ── 3. Generate CSRF state ────────────────────────────────
  const state = crypto.randomBytes(24).toString("hex"); // 48-char hex

  const csrfCookieOpts = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const, // sent on top-level redirects (Google → backend)
    maxAge: 30 * 60,          // 30 minutes
    path: "/",
  };

  reply.setCookie("google_oauth_state", state, csrfCookieOpts);

  // Store username in a signed cookie — prevents tampering
  reply.setCookie("google_oauth_user", username, {
    ...csrfCookieOpts,
    signed: true,
  });

  // ── 4. Build Google OAuth URL ─────────────────────────────
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         GOOGLE_SCOPE,
    access_type:   "offline",  // ← gives us a refresh_token
    prompt:        "consent",  // ← always issue a fresh refresh_token
    state,
  });

  req.log.info({ username }, "[google/oauth/start] SUCCESS — redirecting to Google consent screen");
  return reply.redirect(`${GOOGLE_AUTH_BASE}?${params}`);
};

// ============================================================
// 2️⃣  GOOGLE OAUTH CALLBACK
// Route: GET /api/google/oauth/callback
//
// Google redirects here after the user approves.
// Does NOT require verifyJwt — the CSRF state cookie is the
// only authentication needed at this point.
//
// Flow:
//   1. Verify CSRF state (cookie vs. URL param)
//   2. Recover username from signed google_oauth_user cookie
//   3. Exchange auth code for access_token + refresh_token
//   4. Persist both tokens in the users table
//   5. Clear CSRF cookies and redirect to FRONTEND_URL/integrations
//
// Why store the refresh_token?
//   The access_token expires in 1 hour.  The refresh_token lets your
//   backend call:
//     POST https://oauth2.googleapis.com/token
//     grant_type=refresh_token&refresh_token=...
//   to get a new access_token without user interaction — forever.
// ============================================================
export type GoogleOAuthCallbackQuery = {
  code?: string;
  state?: string;
  error?: string;
  scope?: string;
};

export const googleOAuthCallback = async (
  req: FastifyRequest<{ Querystring: GoogleOAuthCallbackQuery }>,
  reply: FastifyReply
) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

  const clearCsrf = () => {
    reply.clearCookie("google_oauth_state", { path: "/" });
    reply.clearCookie("google_oauth_user",  { path: "/" });
  };

  const fail = (reason: string) => {
    clearCsrf();
    return reply.redirect(
      `${FRONTEND_URL}/integrations?google_error=${encodeURIComponent(reason)}`
    );
  };

  // ── 1. Google error? ──────────────────────────────────────
  const { code, state, error } = req.query;

  req.log.info(
    { hasCode: !!code, hasState: !!state, error },
    "[google/oauth/callback] incoming"
  );

  if (error || !code) {
    req.log.error({ error }, "[google/oauth/callback] FAIL: Google returned error or no code");
    return fail(error || "oauth_failed");
  }

  // ── 2. CSRF verification ──────────────────────────────────
  const storedState = req.cookies?.google_oauth_state;

  req.log.info(
    { storedState: storedState ? "present" : "MISSING", stateMatch: storedState === state },
    "[google/oauth/callback] CSRF check"
  );

  if (!storedState || storedState !== state) {
    req.log.warn("[google/oauth/callback] FAIL: CSRF mismatch");
    return fail("csrf_failed");
  }

  // ── 3. Recover username from signed cookie ────────────────
  const userCookieRaw = req.cookies?.google_oauth_user;
  const { valid, value: username } = userCookieRaw
    ? req.unsignCookie(userCookieRaw)
    : { valid: false, value: null };

  req.log.info(
    { cookiePresent: !!userCookieRaw, signatureValid: valid, username },
    "[google/oauth/callback] user cookie"
  );

  if (!valid || !username) {
    req.log.error("[google/oauth/callback] FAIL: session_expired — cookie missing or unsigned");
    return fail("session_expired");
  }

  // ── 4. Env vars ───────────────────────────────────────────
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    req.log.error("[google/oauth/callback] FAIL: not_configured — missing env vars");
    return fail("not_configured");
  }

  try {
    // ── 5. Exchange authorization code for tokens ─────────
    // Google returns BOTH access_token (1 hr) and refresh_token (permanent)
    // because we sent access_type=offline + prompt=consent
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    "authorization_code",
      }).toString(),
    });

    if (!tokenRes.ok) {
      req.log.error({ body: await tokenRes.text() }, "Google token exchange error");
      return fail("token_exchange_failed");
    }

    const tokenJson: any = await tokenRes.json();

    const accessToken:  string | undefined = tokenJson.access_token;
    const refreshToken: string | undefined = tokenJson.refresh_token;

    if (!accessToken) return fail("token_missing");

    // refresh_token is only returned on first consent — log a warning if absent
    if (!refreshToken) {
      req.log.warn(
        { username },
        "Google did not return a refresh_token — user may have connected before. " +
        "Have the user disconnect and reconnect to force a new consent screen."
      );
    }

    // ── 6. Fetch customer_id from Google Ads ──────────────
    // listAccessibleCustomers returns all accounts the user has access to.
    // We store the first one automatically — client can change later.
    let googleCustomerId: string | null = null;
    try {
      const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
      if (developerToken) {
        const custRes = await fetch(
          "https://googleads.googleapis.com/v18/customers:listAccessibleCustomers",
          {
            headers: {
              Authorization:    `Bearer ${accessToken}`,
              "developer-token": developerToken,
            },
          }
        );
        if (custRes.ok) {
          const custJson: any = await custRes.json();
          // resourceNames look like "customers/1234567890"
          const first: string | undefined = custJson.resourceNames?.[0];
          if (first) googleCustomerId = first.replace("customers/", "");
          req.log.info({ username, googleCustomerId, all: custJson.resourceNames }, "[google/oauth/callback] customer IDs fetched");
        } else {
          const errBody = await custRes.text();
          req.log.warn({ status: custRes.status, body: errBody }, "[google/oauth/callback] listAccessibleCustomers failed");
        }
      } else {
        req.log.warn("[google/oauth/callback] GOOGLE_ADS_DEVELOPER_TOKEN not set — skipping customer ID fetch");
      }
    } catch (custErr) {
      req.log.warn({ custErr }, "[google/oauth/callback] failed to fetch customer ID — continuing without it");
    }

    // ── 7. Persist tokens + customer_id in DB ─────────────
    // Run this SQL first if columns don't exist:
    //   ALTER TABLE users
    //     ADD COLUMN google_access_token  TEXT NULL,
    //     ADD COLUMN google_refresh_token TEXT NULL,
    //     ADD COLUMN google_customer_id   VARCHAR(50) NULL;
    await db
      .updateTable("users")
      .set({
        google_access_token:  accessToken,
        google_refresh_token: refreshToken ?? null,
        google_customer_id:   googleCustomerId,
        updated_at: new Date(),
      } as any)
      .where("username", "=", username)
      .execute();

    // ── 8. Clear CSRF cookies + redirect to success ───────
    req.log.info({ username, googleCustomerId }, "[google/oauth/callback] SUCCESS — tokens saved, redirecting");
    clearCsrf();
    return reply.redirect(
      `${FRONTEND_URL}/integrations?google_success=connected`
    );
  } catch (err) {
    req.log.error(err, "Google OAuth callback error");
    return fail("server_error");
  }
};
