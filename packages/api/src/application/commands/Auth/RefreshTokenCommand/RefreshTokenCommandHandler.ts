import type { CommandHandler } from "@commands/CommandHandler";
import type { RefreshTokenCommand } from "./RefreshTokenCommand";
import type { IRefreshTokenRepository } from "@repositories/RefreshTokenRepository/RefreshTokenRepository";
import type { IUserRepository } from "@repositories/UserRepository/UserRepository";
import type { IAuthService } from "@/services/AuthService/AuthService";
import {
  REFRESH_TOKEN_EXPIRE_DAYS,
  REFRESH_TOKEN_EXPIRE_TIME_IN_SECONDS,
} from "@/services/AuthService/AuthService";
import type { AuthSSOGoogleResponse } from "shared";
import type z from "zod";

export class RefreshTokenCommandHandler implements CommandHandler<
  RefreshTokenCommand,
  z.infer<typeof AuthSSOGoogleResponse>
> {
  constructor(
    private readonly refreshTokenRepository: IRefreshTokenRepository,
    private readonly userRepository: IUserRepository,
    private readonly authService: IAuthService,
  ) { }

  async handle(
    command: RefreshTokenCommand,
  ): Promise<z.infer<typeof AuthSSOGoogleResponse>> {
    const storedToken = await this.refreshTokenRepository.findByToken(
      command.refreshToken,
    );

    if (!storedToken) {
      throw new Error("INVALID_REFRESH_TOKEN");
    }

    if (storedToken.inactive) {
      await this.refreshTokenRepository.revokeTokenChain(storedToken.id!);
      throw new Error("TOKEN_REUSE_DETECTED");
    }

    if (new Date() > storedToken.expiresAt) {
      throw new Error("REFRESH_TOKEN_EXPIRED");
    }

    await this.refreshTokenRepository.update({
      id: storedToken.id!,
      data: {
        inactive: true,
        updatedAt: new Date(),
      },
    });

    const user = await this.userRepository.findById(storedToken.userId);

    if (!user) {
      throw new Error("User not found");
    }

    const newAccessToken = this.authService.generateAccessToken(user);
    const newRefreshToken = this.authService.generateRefreshToken();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRE_DAYS);

    await this.refreshTokenRepository.create({
      userId: storedToken.userId,
      refreshToken: newRefreshToken,
      predecessorId: storedToken.id!,
      expiresAt,
      inactive: false,
    });

    return {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      token_type: "Bearer",
      expires_in: REFRESH_TOKEN_EXPIRE_TIME_IN_SECONDS,
    };
  }
}
