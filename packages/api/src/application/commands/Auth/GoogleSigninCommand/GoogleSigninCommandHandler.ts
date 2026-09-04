import type { CommandHandler } from "@commands/CommandHandler";
import type { GoogleSigninCommand } from "./GoogleSigninCommand";
import type { IUserRepository } from "@repositories/UserRepository/UserRepository";
import type { IUserAuthProviderRepository } from "@repositories/UserAuthProviderRepository/UserAuthProviderRepository";
import type { IRefreshTokenRepository } from "@repositories/RefreshTokenRepository/RefreshTokenRepository";
import type { IAuthService } from "@/services/AuthService/AuthService";
import { EncryptionService } from "@/services/EncryptionService/EncryptionService";
import {
  REFRESH_TOKEN_EXPIRE_DAYS,
  REFRESH_TOKEN_EXPIRE_TIME_IN_SECONDS,
} from "@/services/AuthService/AuthService";

export interface GoogleSigninResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export class GoogleSigninCommandHandler implements CommandHandler<
  GoogleSigninCommand,
  GoogleSigninResponse
> {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly userAuthProviderRepository: IUserAuthProviderRepository,
    private readonly refreshTokenRepository: IRefreshTokenRepository,
    private readonly authService: IAuthService,
  ) { }

  async handle(command: GoogleSigninCommand): Promise<GoogleSigninResponse> {
    const googleTokens = await this.authService.exchangeGoogleCode(
      command.code,
    );

    const googleProfile = await this.authService.verifyGoogleIdToken(
      googleTokens.id_token,
    );

    if (!googleProfile.email) {
      throw new Error("Email not provided by Google");
    }

    let userAuthProvider =
      await this.userAuthProviderRepository.findByProviderAndUserId(
        "google",
        googleProfile.id,
      );

    let user;

    if (userAuthProvider) {
      user = await this.userRepository.findById(userAuthProvider.userId);

      if (!user) {
        throw new Error("User record not found for existing auth provider");
      }
    } else {
      user = await this.userRepository.findByEmail(googleProfile.email);

      if (!user) {
        const nameParts = (googleProfile.name || "").split(" ");
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";

        user = await this.userRepository.create({
          firstName,
          lastName,
          email: googleProfile.email,
        });
      }
    }

    await this.userAuthProviderRepository.upsert({
      userId: user.id!,
      provider: "google",
      providerUserId: googleProfile.id,
      providerEmail: googleProfile.email,
      googleAccessToken: googleTokens.access_token
        ? EncryptionService.encrypt(googleTokens.access_token)
        : null,
      googleRefreshToken: googleTokens.refresh_token
        ? EncryptionService.encrypt(googleTokens.refresh_token)
        : null,
      googleTokenExpiresAt: new Date(googleTokens.expiry_date),
      scopes: command.scope ?? "openid email profile",
    });

    const accessToken = this.authService.generateAccessToken(user);

    const refreshToken = this.authService.generateRefreshToken();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRE_DAYS);

    await this.refreshTokenRepository.create({
      userId: user.id!,
      refreshToken,
      predecessorId: null,
      expiresAt,
      inactive: false,
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: REFRESH_TOKEN_EXPIRE_TIME_IN_SECONDS,
    };
  }
}
