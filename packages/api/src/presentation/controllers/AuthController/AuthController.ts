import type { Request, Response } from "express";
import type { IAuthContainer } from "@containers/AuthContainer";
import type { AuthenticatedRequest } from "@/presentation/middleware/AuthMiddleware/AuthMiddleware";

export class AuthController {
  constructor(private readonly authContainer: IAuthContainer) { }

  async googleSignin(req: Request, res: Response): Promise<void> {
    try {
      const { code, scope } = req.body;

      if (!code) {
        res.status(400).json({ error: "code is required" });
        return;
      }

      const tokens = await this.authContainer.googleSigninHandler.handle({
        code,
        scope,
      });

      res.json(tokens);
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage.includes("Google token")) {
        res.status(401).json({ error: "Invalid Google authorization" });
      } else {
        console.error("Google signin error:", error);
        res.status(500).json({ error: "Failed to sign in with Google" });
      }
    }
  }

  async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        res.status(400).json({ error: "refresh_token is required" });
        return;
      }

      const tokens = await this.authContainer.refreshTokenHandler.handle({
        refreshToken: refresh_token,
      });

      res.json(tokens);
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage === "INVALID_REFRESH_TOKEN") {
        res.status(401).json({
          error: "Invalid refresh token",
          code: "INVALID_REFRESH_TOKEN",
        });
      } else if (errorMessage === "TOKEN_REUSE_DETECTED") {
        res.status(401).json({
          error: "Token reuse detected - all sessions revoked",
          code: "TOKEN_REUSE_DETECTED",
        });
      } else if (errorMessage === "REFRESH_TOKEN_EXPIRED") {
        res.status(401).json({
          error: "Refresh token expired - please log in again",
          code: "REFRESH_TOKEN_EXPIRED",
        });
      } else {
        console.error("Refresh token error:", error);
        res.status(500).json({ error: "Failed to refresh token" });
      }
    }
  }

  async getCurrentUser(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      res.json(req.user);
    } catch (error) {
      res.status(500).json({ error: "Failed to get user information" });
    }
  }

  async getSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const sessions =
        await this.authContainer.refreshTokenRepository.findActiveByUserId(
          req.user.sub,
        );

      const sessionRoots = sessions.filter((s) => !s.predecessorId);

      const sessionList = sessionRoots.map((root) => ({
        id: root.id,
        createdAt: root.createdAt,
        expiresAt: root.expiresAt,
      }));

      res.json({ sessions: sessionList });
    } catch (error) {
      console.error("Get sessions error:", error);
      res.status(500).json({ error: "Failed to get sessions" });
    }
  }

  async revokeSession(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const sessionId = req.params.sessionId;

      if (!sessionId || typeof sessionId !== "string") {
        res.status(400).json({ error: "sessionId is required" });
        return;
      }

      const session = await this.authContainer.refreshTokenRepository.find({
        id: sessionId,
      });

      if (!session || session.userId !== req.user.sub) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      await this.authContainer.refreshTokenRepository.revokeTokenChain(
        sessionId,
      );

      res.json({ message: "Session revoked successfully" });
    } catch (error) {
      console.error("Revoke session error:", error);
      res.status(500).json({ error: "Failed to revoke session" });
    }
  }
}
