import type { Request, Response, NextFunction } from "express";
import type { DecodedToken } from "@/services/AuthService/AuthService";
import { Container } from "@/presentation/containers";
import { checkStoredLicense } from "@/licenses/licenseFile";

export interface AuthenticatedRequest extends Request {
  user?: DecodedToken;
}

// Electron ships with no JWT at all — just a locally-stored license file. Gates routes only
// the desktop client ever calls.
export async function licenseMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const valid = await checkStoredLicense();
  if (!valid) {
    res.status(401).json({ error: "No valid license" });
    return;
  }
  next();
}

async function verifyBearerToken(req: AuthenticatedRequest): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return false;

  try {
    req.user = await Container.auth.authService.verifyAccessToken(authHeader.substring(7));
    return true;
  } catch {
    return false;
  }
}

// Web app auth — verifies the Bearer access token and attaches the decoded user. Gates routes
// only the web app ever calls (account/session management — no desktop equivalent).
export async function jwtMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "No token provided" });
    return;
  }

  if (await verifyBearerToken(req)) {
    next();
    return;
  }

  res.status(401).json({ error: "Token expired or invalid", code: "TOKEN_EXPIRED" });
}

// Campaign generation is reachable from both the Electron desktop client (license file, no
// token) and the browser-based cloud client (JWT, no license file) — either proves the caller
// is entitled to generate, so accept whichever is present instead of requiring both.
export async function licenseOrJwtMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (await checkStoredLicense()) {
    next();
    return;
  }

  if (await verifyBearerToken(req)) {
    next();
    return;
  }

  res.status(401).json({ error: "No valid license or access token" });
}
