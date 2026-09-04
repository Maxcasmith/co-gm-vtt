import {
  JWTAuthService,
  type IAuthService,
} from "@/services/AuthService/AuthService";
import { UserRepository } from "@repositories/UserRepository/UserRepository";
import { UserAuthProviderRepository } from "@repositories/UserAuthProviderRepository/UserAuthProviderRepository";
import { RefreshTokenRepository } from "@repositories/RefreshTokenRepository/RefreshTokenRepository";
import { GoogleSigninCommandHandler } from "@commands/Auth/GoogleSigninCommand/GoogleSigninCommandHandler";
import { RefreshTokenCommandHandler } from "@commands/Auth/RefreshTokenCommand/RefreshTokenCommandHandler";

export interface IAuthContainer {
  authService: IAuthService;
  userRepository: UserRepository;
  userAuthProviderRepository: UserAuthProviderRepository;
  refreshTokenRepository: RefreshTokenRepository;
  googleSigninHandler: GoogleSigninCommandHandler;
  refreshTokenHandler: RefreshTokenCommandHandler;
}

export class AuthContainer implements IAuthContainer {
  private _authService!: IAuthService;
  private _userRepository!: UserRepository;
  private _userAuthProviderRepository!: UserAuthProviderRepository;
  private _refreshTokenRepository!: RefreshTokenRepository;
  private _googleSigninHandler!: GoogleSigninCommandHandler;
  private _refreshTokenHandler!: RefreshTokenCommandHandler;

  get authService(): IAuthService {
    if (!this._authService) {
      this._authService = new JWTAuthService();
    }
    return this._authService;
  }

  get userRepository(): UserRepository {
    if (!this._userRepository) {
      this._userRepository = new UserRepository();
    }
    return this._userRepository;
  }

  get userAuthProviderRepository(): UserAuthProviderRepository {
    if (!this._userAuthProviderRepository) {
      this._userAuthProviderRepository = new UserAuthProviderRepository();
    }
    return this._userAuthProviderRepository;
  }

  get refreshTokenRepository(): RefreshTokenRepository {
    if (!this._refreshTokenRepository) {
      this._refreshTokenRepository = new RefreshTokenRepository();
    }
    return this._refreshTokenRepository;
  }

  get googleSigninHandler(): GoogleSigninCommandHandler {
    if (!this._googleSigninHandler) {
      this._googleSigninHandler = new GoogleSigninCommandHandler(
        this.userRepository,
        this.userAuthProviderRepository,
        this.refreshTokenRepository,
        this.authService,
      );
    }
    return this._googleSigninHandler;
  }

  get refreshTokenHandler(): RefreshTokenCommandHandler {
    if (!this._refreshTokenHandler) {
      this._refreshTokenHandler = new RefreshTokenCommandHandler(
        this.refreshTokenRepository,
        this.userRepository,
        this.authService,
      );
    }
    return this._refreshTokenHandler;
  }
}
