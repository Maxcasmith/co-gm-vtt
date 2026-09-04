import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";
import type { User } from "@entities/User/User";

export interface GoogleProfile {
  id: string;
  email: string;
  name: string;
  picture: string | undefined;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token: string | undefined;
  expiry_date: number;
  id_token: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface IAuthService {
  generateAccessToken(user: User): string;
  generateRefreshToken(): string;
  verifyAccessToken(token: string): Promise<DecodedToken>;
  verifyGoogleIdToken(idToken: string): Promise<GoogleProfile>;
  exchangeGoogleCode(code: string): Promise<GoogleTokens>;
}

export interface DecodedToken {
  sub: string;
  email: string;
  name: string;
  iat?: number;
  exp?: number;
}

const ACCESS_TOKEN_EXPIRE_TIME = "15m"; // 15 minutes
export const REFRESH_TOKEN_EXPIRE_DAYS = 7; // 7 days
export const REFRESH_TOKEN_EXPIRE_TIME_IN_SECONDS = 900;

export class JWTAuthService implements IAuthService {
  private jwtSecret: string;
  private googleClient: OAuth2Client;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET!;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || "postmessage";

    if (!this.jwtSecret) {
      throw new Error("JWT_SECRET must be set in environment variables");
    }

    if (!clientId || !clientSecret) {
      throw new Error(
        "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment variables",
      );
    }

    this.googleClient = new OAuth2Client(clientId, clientSecret, redirectUri);
  }

  generateAccessToken(user: User) {
    const payload: DecodedToken = {
      sub: user.id!,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: ACCESS_TOKEN_EXPIRE_TIME,
    });
  }

  generateRefreshToken() {
    return crypto.randomBytes(64).toString("hex");
  }

  async verifyAccessToken(token: string) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as DecodedToken;
      return decoded;
    } catch (error) {
      throw new Error("Invalid or expired access token");
    }
  }

  async verifyGoogleIdToken(idToken: string) {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;

      if (!clientId) {
        throw new Error("GOOGLE_CLIENT_ID is not configured");
      }

      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: clientId,
      });

      const payload = ticket.getPayload();

      if (!payload) {
        throw new Error("Invalid Google token - no payload");
      }

      if (!payload.email) {
        throw new Error("Google token does not contain email");
      }

      return {
        id: payload.sub,
        email: payload.email,
        name: payload.name || "",
        picture: payload.picture,
      };
    } catch (error) {
      throw new Error(
        `Failed to verify Google token: ${(error as Error).message}`,
      );
    }
  }

  async exchangeGoogleCode(code: string) {
    try {
      const { tokens } = await this.googleClient.getToken(code);

      if (!tokens.access_token || !tokens.id_token) {
        throw new Error("Failed to get tokens from Google");
      }

      return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || undefined,
        expiry_date: tokens.expiry_date || Date.now() + 3600 * 1000,
        id_token: tokens.id_token,
      };
    } catch (error) {
      throw new Error(
        `Failed to exchange Google code: ${(error as Error).message}`,
      );
    }
  }
}
