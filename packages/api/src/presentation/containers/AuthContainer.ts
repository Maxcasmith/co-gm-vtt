import {
  JWTAuthService,
  type IAuthService,
} from "@/services/AuthService/AuthService";
import { UserRepository } from "@repositories/UserRepository/UserRepository";
import { UserAuthProviderRepository } from "@repositories/UserAuthProviderRepository/UserAuthProviderRepository";
import { RefreshTokenRepository } from "@repositories/RefreshTokenRepository/RefreshTokenRepository";
import { UserProductRepository } from "@repositories/UserProductRepository/UserProductRepository";
import { GoogleSigninCommandHandler } from "@commands/Auth/GoogleSigninCommand/GoogleSigninCommandHandler";
import { RefreshTokenCommandHandler } from "@commands/Auth/RefreshTokenCommand/RefreshTokenCommandHandler";
import { CreateUserCommandHandler } from "@commands/Auth/CreateUserCommand/CreateUserCommandHandler";
import { LoginCommandHandler } from "@commands/Auth/LoginCommand/LoginCommandHandler";
import { ChangePasswordCommandHandler } from "@commands/Auth/ChangePasswordCommand/ChangePasswordCommandHandler";

export interface IAuthContainer {
  authService: IAuthService;
  userRepository: UserRepository;
  userAuthProviderRepository: UserAuthProviderRepository;
  refreshTokenRepository: RefreshTokenRepository;
  userProductRepository: UserProductRepository;
  googleSigninHandler: GoogleSigninCommandHandler;
  refreshTokenHandler: RefreshTokenCommandHandler;
  createUserHandler: CreateUserCommandHandler;
  loginHandler: LoginCommandHandler;
  changePasswordHandler: ChangePasswordCommandHandler;
}

export class AuthContainer implements IAuthContainer {
  private _authService!: IAuthService;
  private _userRepository!: UserRepository;
  private _userAuthProviderRepository!: UserAuthProviderRepository;
  private _refreshTokenRepository!: RefreshTokenRepository;
  private _userProductRepository!: UserProductRepository;
  private _googleSigninHandler!: GoogleSigninCommandHandler;
  private _refreshTokenHandler!: RefreshTokenCommandHandler;
  private _createUserHandler!: CreateUserCommandHandler;
  private _loginHandler!: LoginCommandHandler;
  private _changePasswordHandler!: ChangePasswordCommandHandler;

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

  get userProductRepository(): UserProductRepository {
    if (!this._userProductRepository) {
      this._userProductRepository = new UserProductRepository();
    }
    return this._userProductRepository;
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

  get createUserHandler(): CreateUserCommandHandler {
    if (!this._createUserHandler) {
      this._createUserHandler = new CreateUserCommandHandler(
        this.userRepository,
        this.refreshTokenRepository,
        this.authService,
        this.userProductRepository,
        this.googleSigninHandler,
      );
    }
    return this._createUserHandler;
  }

  get loginHandler(): LoginCommandHandler {
    if (!this._loginHandler) {
      this._loginHandler = new LoginCommandHandler(
        this.userRepository,
        this.refreshTokenRepository,
        this.authService,
      );
    }
    return this._loginHandler;
  }

  get changePasswordHandler(): ChangePasswordCommandHandler {
    if (!this._changePasswordHandler) {
      this._changePasswordHandler = new ChangePasswordCommandHandler(this.userRepository);
    }
    return this._changePasswordHandler;
  }
}
