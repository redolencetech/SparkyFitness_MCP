import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import pool from "../db/pool.js";
import { signAccessToken } from "./jwt.js";
import { verifyCodeChallenge } from "./pkce.js";
import { AUTH_CODE_EXPIRY_SECONDS, REFRESH_TOKEN_EXPIRY_DAYS } from "../constants.js";

const router = Router();

// Rate limiter: 10 requests per minute on sensitive endpoints
const oauthRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function renderLoginPage(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  scope: string;
  error?: string;
}): string {
  const { clientId, redirectUri, codeChallenge, codeChallengeMethod, state, scope, error } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SparkyFitness - Authorize</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; width: 100%; }
    h1 { margin: 0 0 0.5rem; font-size: 1.5rem; color: #333; }
    p { color: #666; margin: 0 0 1.5rem; font-size: 0.9rem; }
    label { display: block; margin-bottom: 0.25rem; font-weight: 500; color: #444; font-size: 0.9rem; }
    input[type="email"], input[type="password"] { width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem; box-sizing: border-box; margin-bottom: 1rem; }
    button { width: 100%; padding: 0.75rem; background: #4f46e5; color: white; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; font-weight: 500; }
    button:hover { background: #4338ca; }
    .error { background: #fef2f2; color: #dc2626; padding: 0.75rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>SparkyFitness</h1>
    <p>Sign in to authorize access to your fitness data.</p>
    ${error ? `<div class="error">${error}</div>` : ""}
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${clientId}">
      <input type="hidden" name="redirect_uri" value="${redirectUri}">
      <input type="hidden" name="code_challenge" value="${codeChallenge}">
      <input type="hidden" name="code_challenge_method" value="${codeChallengeMethod}">
      <input type="hidden" name="state" value="${state}">
      <input type="hidden" name="scope" value="${scope}">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autocomplete="email">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`;
}

// ─── GET /.well-known/oauth-authorization-server ─────────────────────────────

router.get("/.well-known/oauth-authorization-server", (_req, res) => {
  const issuer = process.env.MCP_OAUTH_ISSUER || "";
  res.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp:tools"],
  });
});

// ─── POST /oauth/register ────────────────────────────────────────────────────

router.post("/oauth/register", async (req, res) => {
  try {
    const { client_name, redirect_uris } = req.body;

    if (!client_name || typeof client_name !== "string") {
      res.status(400).json({ error: "client_name is required" });
      return;
    }

    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      res.status(400).json({ error: "redirect_uris must be a non-empty array" });
      return;
    }

    // Validate each redirect_uri is a valid URL
    for (const uri of redirect_uris) {
      try {
        new URL(uri);
      } catch {
        res.status(400).json({ error: `Invalid redirect_uri: ${uri}` });
        return;
      }
    }

    const clientId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris)
       VALUES ($1, $2, $3)`,
      [clientId, client_name, redirect_uris]
    );

    res.status(201).json({
      client_id: clientId,
      client_name,
      redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  } catch (error) {
    console.error("[OAuth] Client registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /oauth/authorize ────────────────────────────────────────────────────

router.get("/oauth/authorize", oauthRateLimiter, async (req, res) => {
  try {
    const {
      client_id,
      redirect_uri,
      response_type,
      code_challenge,
      code_challenge_method,
      state,
      scope,
    } = req.query as Record<string, string>;

    // Validate required params
    if (response_type !== "code") {
      res.status(400).json({ error: "response_type must be 'code'" });
      return;
    }

    if (!client_id || !redirect_uri || !code_challenge) {
      res.status(400).json({ error: "Missing required parameters: client_id, redirect_uri, code_challenge" });
      return;
    }

    if (code_challenge_method && code_challenge_method !== "S256") {
      res.status(400).json({ error: "Only S256 code_challenge_method is supported" });
      return;
    }

    // Validate client exists and redirect_uri matches
    const clientResult = await pool.query(
      "SELECT redirect_uris FROM mcp_oauth_clients WHERE client_id = $1",
      [client_id]
    );

    if (clientResult.rows.length === 0) {
      res.status(400).json({ error: "Unknown client_id" });
      return;
    }

    const registeredUris: string[] = clientResult.rows[0].redirect_uris;
    if (!registeredUris.includes(redirect_uri)) {
      res.status(400).json({ error: "redirect_uri does not match registered URIs" });
      return;
    }

    // Render login form
    res.setHeader("Content-Type", "text/html");
    res.send(renderLoginPage({
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || "S256",
      state: state || "",
      scope: scope || "mcp:tools",
    }));
  } catch (error) {
    console.error("[OAuth] Authorize error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /oauth/authorize (form submission) ─────────────────────────────────

router.post("/oauth/authorize", oauthRateLimiter, async (req, res) => {
  try {
    const {
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      state,
      scope,
      email,
      password,
    } = req.body;

    // Validate client and redirect_uri
    const clientResult = await pool.query(
      "SELECT redirect_uris FROM mcp_oauth_clients WHERE client_id = $1",
      [client_id]
    );

    if (clientResult.rows.length === 0) {
      res.status(400).json({ error: "Unknown client_id" });
      return;
    }

    const registeredUris: string[] = clientResult.rows[0].redirect_uris;
    if (!registeredUris.includes(redirect_uri)) {
      res.status(400).json({ error: "redirect_uri does not match registered URIs" });
      return;
    }

    // Authenticate user against the existing account table (Better Auth credential accounts)
    const userResult = await pool.query(
      `SELECT u.id, a.password FROM "user" u
       JOIN account a ON a.user_id = u.id
       WHERE u.email = $1 AND a.provider_id = 'credential'`,
      [email]
    );

    if (userResult.rows.length === 0) {
      res.setHeader("Content-Type", "text/html");
      res.send(renderLoginPage({
        clientId: client_id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method || "S256",
        state: state || "",
        scope: scope || "mcp:tools",
        error: "Invalid email or password.",
      }));
      return;
    }

    const { id: userId, password: hashedPassword } = userResult.rows[0];

    const passwordValid = await bcrypt.compare(password, hashedPassword);
    if (!passwordValid) {
      res.setHeader("Content-Type", "text/html");
      res.send(renderLoginPage({
        clientId: client_id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method || "S256",
        state: state || "",
        scope: scope || "mcp:tools",
        error: "Invalid email or password.",
      }));
      return;
    }

    // Generate authorization code
    const code = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + AUTH_CODE_EXPIRY_SECONDS * 1000);

    await pool.query(
      `INSERT INTO mcp_oauth_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [code, client_id, userId, redirect_uri, code_challenge, code_challenge_method || "S256", scope || "mcp:tools", expiresAt]
    );

    // Redirect back to client with authorization code
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (state) {
      redirectUrl.searchParams.set("state", state);
    }

    res.redirect(302, redirectUrl.toString());
  } catch (error) {
    console.error("[OAuth] Authorize POST error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /oauth/token ───────────────────────────────────────────────────────

router.post("/oauth/token", oauthRateLimiter, async (req, res) => {
  try {
    const { grant_type } = req.body;

    if (grant_type === "authorization_code") {
      await handleAuthorizationCodeGrant(req, res);
    } else if (grant_type === "refresh_token") {
      await handleRefreshTokenGrant(req, res);
    } else {
      res.status(400).json({ error: "unsupported_grant_type" });
    }
  } catch (error) {
    console.error("[OAuth] Token error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function handleAuthorizationCodeGrant(
  req: import("express").Request,
  res: import("express").Response
): Promise<void> {
  const { code, redirect_uri, client_id, code_verifier } = req.body;

  if (!code || !redirect_uri || !client_id || !code_verifier) {
    res.status(400).json({ error: "invalid_request", error_description: "Missing required parameters" });
    return;
  }

  // Atomically mark code as used and retrieve it (prevents replay attacks)
  const codeResult = await pool.query(
    `UPDATE mcp_oauth_codes
     SET used = TRUE
     WHERE code = $1 AND used = FALSE AND expires_at > NOW()
     RETURNING client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope`,
    [code]
  );

  if (codeResult.rows.length === 0) {
    res.status(400).json({ error: "invalid_grant", error_description: "Authorization code is invalid, expired, or already used" });
    return;
  }

  const authCode = codeResult.rows[0];

  // Validate client_id and redirect_uri match
  if (authCode.client_id !== client_id) {
    res.status(400).json({ error: "invalid_grant", error_description: "client_id mismatch" });
    return;
  }

  if (authCode.redirect_uri !== redirect_uri) {
    res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
    return;
  }

  // Verify PKCE code_verifier against stored code_challenge
  if (!verifyCodeChallenge(code_verifier, authCode.code_challenge)) {
    res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
    return;
  }

  // Issue access token
  const accessToken = signAccessToken(authCode.user_id, client_id, authCode.scope);

  // Generate and store refresh token (stored as SHA-256 hash)
  const refreshToken = crypto.randomBytes(32).toString("hex");
  const refreshTokenHash = hashToken(refreshToken);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO mcp_oauth_refresh_tokens (token_hash, user_id, client_id, scope, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [refreshTokenHash, authCode.user_id, client_id, authCode.scope, refreshExpiresAt]
  );

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refreshToken,
    scope: authCode.scope,
  });
}

async function handleRefreshTokenGrant(
  req: import("express").Request,
  res: import("express").Response
): Promise<void> {
  const { refresh_token, client_id } = req.body;

  if (!refresh_token || !client_id) {
    res.status(400).json({ error: "invalid_request", error_description: "Missing required parameters" });
    return;
  }

  const tokenHash = hashToken(refresh_token);

  // Look up the refresh token by hash
  const tokenResult = await pool.query(
    `SELECT user_id, client_id, scope, expires_at, revoked
     FROM mcp_oauth_refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );

  if (tokenResult.rows.length === 0) {
    res.status(400).json({ error: "invalid_grant", error_description: "Invalid refresh token" });
    return;
  }

  const storedToken = tokenResult.rows[0];

  // Check if revoked
  if (storedToken.revoked) {
    res.status(400).json({ error: "invalid_grant", error_description: "Refresh token has been revoked" });
    return;
  }

  // Check if expired
  if (new Date(storedToken.expires_at) < new Date()) {
    res.status(400).json({ error: "invalid_grant", error_description: "Refresh token has expired" });
    return;
  }

  // Validate client_id matches
  if (storedToken.client_id !== client_id) {
    res.status(400).json({ error: "invalid_grant", error_description: "client_id mismatch" });
    return;
  }

  // Issue new access token
  const accessToken = signAccessToken(storedToken.user_id, client_id, storedToken.scope);

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: storedToken.scope,
  });
}

// ─── POST /oauth/revoke ──────────────────────────────────────────────────────

router.post("/oauth/revoke", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      // Per RFC 7009, respond with 200 even if token is missing
      res.status(200).json({});
      return;
    }

    const tokenHash = hashToken(token);

    await pool.query(
      "UPDATE mcp_oauth_refresh_tokens SET revoked = TRUE WHERE token_hash = $1",
      [tokenHash]
    );

    // Always return 200 per RFC 7009 (even if token not found)
    res.status(200).json({});
  } catch (error) {
    console.error("[OAuth] Revoke error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
