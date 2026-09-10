import bcrypt from "bcrypt";
import type { CommandHandler } from "@commands/CommandHandler";
import type { CreateUserCommand } from "./CreateUserCommand";
import type { GoogleSigninCommandHandler } from "@commands/Auth/GoogleSigninCommand/GoogleSigninCommandHandler";
import type { IUserRepository } from "@repositories/UserRepository/UserRepository";
import type { IRefreshTokenRepository } from "@repositories/RefreshTokenRepository/RefreshTokenRepository";
import type { IUserProductRepository } from "@repositories/UserProductRepository/UserProductRepository";
import type { IAuthService } from "@/services/AuthService/AuthService";
import {
  REFRESH_TOKEN_EXPIRE_DAYS,
  REFRESH_TOKEN_EXPIRE_TIME_IN_SECONDS,
} from "@/services/AuthService/AuthService";
import type { AuthSSOGoogleResponse } from "shared";
import type z from "zod";

const PASSWORD_HASH_ROUNDS = 10;

type TokenResponse = z.infer<typeof AuthSSOGoogleResponse>;

export class CreateUserCommandHandler implements CommandHandler<
  CreateUserCommand,
  TokenResponse
> {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly refreshTokenRepository: IRefreshTokenRepository,
    private readonly authService: IAuthService,
    private readonly userProductRepository: IUserProductRepository,
    private readonly googleSigninHandler: GoogleSigninCommandHandler,
  ) { }

  async handle(command: CreateUserCommand): Promise<TokenResponse> {
    const tokens = command.googleCode
      ? await this.googleSigninHandler.handle({
        code: command.googleCode,
        scope: command.scope,
      })
      : await this.createWithPassword(command);

    if (command.productId) {
      const decoded = await this.authService.verifyAccessToken(
        tokens.access_token,
      );
      await this.userProductRepository.create(decoded.sub, command.productId);
    }

    return tokens;
  }

  private async createWithPassword(
    command: CreateUserCommand,
  ): Promise<TokenResponse> {
    if (
      !command.firstName ||
      !command.lastName ||
      !command.email ||
      !command.password
    ) {
      throw new Error("MISSING_FIELDS");
    }

    const existing = await this.userRepository.findByEmail(command.email);

    if (existing) {
      throw new Error("EMAIL_ALREADY_EXISTS");
    }

    const hashedPassword = await bcrypt.hash(
      command.password,
      PASSWORD_HASH_ROUNDS,
    );

    const user = await this.userRepository.create({
      firstName: command.firstName,
      lastName: command.lastName,
      email: command.email,
      password: hashedPassword,
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
