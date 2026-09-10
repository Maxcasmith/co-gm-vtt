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

  async signup(req: Request, res: Response): Promise<void> {
    try {
      const { firstName, lastName, email, password, googleCode, scope, productId } =
        req.body;

      if (!googleCode && (!firstName || !lastName || !email || !password)) {
        res.status(400).json({
          error: "firstName, lastName, email and password are required",
        });
        return;
      }

      const tokens = await this.authContainer.createUserHandler.handle({
        firstName,
        lastName,
        email,
        password,
        googleCode,
        scope,
        productId,
      });

      res.json(tokens);
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage === "EMAIL_ALREADY_EXISTS") {
        res.status(409).json({ error: "Email already in use" });
      } else if (errorMessage.includes("Google token")) {
        res.status(401).json({ error: "Invalid Google authorization" });
      } else {
        console.error("Signup error:", error);
        res.status(500).json({ error: "Failed to create account" });
      }
    }
  }

  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: "email and password are required" });
        return;
      }

      const tokens = await this.authContainer.loginHandler.handle({
        email,
        password,
      });

      res.json(tokens);
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage === "INVALID_CREDENTIALS") {
        res.status(401).json({ error: "Invalid email or password" });
      } else {
        console.error("Login error:", error);
        res.status(500).json({ error: "Failed to log in" });
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

      // findActiveByUserId returns exactly one row per open chain: rotation marks every
      // earlier token in a chain `inactive`, so the current leaf is the only active row
      // — filtering to predecessorId-less roots here would miss every chain that has
      // ever rotated, since the root itself goes inactive on its first refresh.
      const activeLeaves =
        await this.authContainer.refreshTokenRepository.findActiveByUserId(
          req.user.sub,
        );

      const sessionList = await Promise.all(activeLeaves.map(async (leaf) => {
        const chain = await this.authContainer.refreshTokenRepository.findTokenChain(leaf.id!);
        const root = chain.find((t) => !t.predecessorId) ?? leaf;
        return {
          id: leaf.id,
          createdAt: root.createdAt,
          expiresAt: leaf.expiresAt,
        };
      }));

      res.json({ sessions: sessionList });
    } catch (error) {
      console.error("Get sessions error:", error);
      res.status(500).json({ error: "Failed to get sessions" });
    }
  }

  async changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: "currentPassword and newPassword are required" });
        return;
      }

      await this.authContainer.changePasswordHandler.handle({
        userId: req.user.sub,
        currentPassword,
        newPassword,
      });

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage === "INVALID_CREDENTIALS") {
        res.status(401).json({ error: "Current password is incorrect" });
      } else {
        console.error("Change password error:", error);
        res.status(500).json({ error: "Failed to change password" });
      }
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
