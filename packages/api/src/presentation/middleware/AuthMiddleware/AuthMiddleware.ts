import type { Request, Response, NextFunction } from "express";
import type { DecodedToken } from "@/services/AuthService/AuthService";
import { Container } from "@/presentation/containers";
import { checkStoredLicense } from "@/licenses/licenseFile";

export interface AuthenticatedRequest extends Request {
  user?: DecodedToken;
}

// The SaaS deployment sets DEPLOY_TARGET=saas (it already needs a .env for DB/JWT config).
// Electron ships with no env file at all, so the default path here — no bearer token, just the
// locally-stored license — is what runs when the var is unset.
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (process.env.DEPLOY_TARGET !== "saas") {
    const valid = await checkStoredLicense();
    if (!valid) {
      res.status(401).json({ error: "No valid license" });
      return;
    }
    next();
    return;
  }

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "No token provided" });
      return;
    }

    const token = authHeader.substring(7);

    try {
      const user = await Container.auth.authService.verifyAccessToken(token);
      req.user = user;
      next();
    } catch (error) {
      res.status(401).json({
        error: "Token expired or invalid",
        code: "TOKEN_EXPIRED",
      });
    }
  } catch (error) {
    res.status(401).json({
      error: "Authentication failed",
      message: (error as Error).message,
    });
  }
}
