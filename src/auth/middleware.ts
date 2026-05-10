import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "./jwt.js";
import type { AccessTokenPayload } from "../types.js";

// Extend Express Request to include auth context
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      tokenPayload?: AccessTokenPayload;
    }
  }
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Authentication required. Provide a Bearer token." });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    req.tokenPayload = payload;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired token. Please re-authenticate." });
    return;
  }
}
