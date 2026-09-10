import bcrypt from "bcrypt";
import type { CommandHandler } from "@commands/CommandHandler";
import type { LoginCommand } from "./LoginCommand";
import type { IUserRepository } from "@repositories/UserRepository/UserRepository";
import type { IRefreshTokenRepository } from "@repositories/RefreshTokenRepository/RefreshTokenRepository";
import type { IAuthService } from "@/services/AuthService/AuthService";
import {
  REFRESH_TOKEN_EXPIRE_DAYS,
  REFRESH_TOKEN_EXPIRE_TIME_IN_SECONDS,
} from "@/services/AuthService/AuthService";
import type { AuthSSOGoogleResponse } from "shared";
import type z from "zod";

export class LoginCommandHandler implements CommandHandler<
  LoginCommand,
  z.infer<typeof AuthSSOGoogleResponse>
> {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly refreshTokenRepository: IRefreshTokenRepository,
    private readonly authService: IAuthService,
  ) { }

  async handle(
    command: LoginCommand,
  ): Promise<z.infer<typeof AuthSSOGoogleResponse>> {
    const user = await this.userRepository.findByEmail(command.email);

    if (!user || !user.password) {
      throw new Error("INVALID_CREDENTIALS");
    }

    const passwordMatches = await bcrypt.compare(
      command.password,
      user.password,
    );

    if (!passwordMatches) {
      throw new Error("INVALID_CREDENTIALS");
    }

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
