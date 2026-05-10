import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { AccessTokenPayload } from "../types.js";
import { TOKEN_EXPIRY_SECONDS } from "../constants.js";

const JWT_SECRET = process.env.MCP_OAUTH_JWT_SECRET || "";

if (!JWT_SECRET) {
  console.error("FATAL: MCP_OAUTH_JWT_SECRET environment variable is required");
  process.exit(1);
}

/**
 * Signs an access token JWT with the user's identity.
 */
export function signAccessToken(userId: string, clientId: string, scope: string): string {
  const payload: Omit<AccessTokenPayload, "exp" | "iat"> = {
    sub: userId,
    iss: process.env.MCP_OAUTH_ISSUER || "",
    aud: clientId,
    scope,
    jti: crypto.randomUUID(),
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY_SECONDS,
    algorithm: "HS256",
  });
}

/**
 * Verifies and decodes an access token JWT.
 * Throws if the token is invalid, expired, or tampered with.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: process.env.MCP_OAUTH_ISSUER || undefined,
  });
  return decoded as AccessTokenPayload;
}
