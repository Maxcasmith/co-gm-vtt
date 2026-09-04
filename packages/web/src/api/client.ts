import { toFormData, type FormDataValue } from "../helpers/toFormData";
import { AuthService } from "./services/authService/authService";
import { OnboardingService } from "./services/onboardingService/onboardingService";

interface APIClientProps {
  base: string;
}

export interface IAPIClient {
  get(endpoint: string): Promise<Response>;
  post(endpoint: string, body: object): Promise<Response>;
  setAccessToken(access: string): void;
  revokeAccessToken(): void;
}

interface ApiError {
  code?: string;
  message: string;
  status: number;
}

class APIClient implements IAPIClient {
  private readonly _base: string;
  private readonly _headers: Headers;

  private _auth!: AuthService;
  private _onboarding!: OnboardingService;

  constructor(props: APIClientProps) {
    this._base = props.base;
    this._headers = new Headers();

    if (localStorage.getItem("access_token"))
      this.setAccessToken(localStorage.getItem("access_token") as string);
  }

  get auth() {
    if (!this._auth) this._auth = new AuthService(this);
    return this._auth;
  }

  get onboarding() {
    if (!this._onboarding) this._onboarding = new OnboardingService(this);
    return this._onboarding;
  }

  // Tokens and functions
  setAccessToken(access: string): void {
    this._headers.set("Authorization", "Bearer " + access);
  }

  revokeAccessToken() {
    this._headers.delete("Authorization");
  }

  private async handleTokenExpired<T>(
    err: ApiError,
    retry: () => Promise<T>,
  ): Promise<T> {
    if (err?.code !== "TOKEN_EXPIRED") {
      throw err;
    }

    try {
      await this.auth.refreshToken();
      return await retry();
    } catch (refreshError) {
      this.auth.revokeTokens();
      throw refreshError;
    }
  }

  async get(endpoint: string) {
    const execute = async () => {
      const res = await fetch(`${this._base}/api/` + endpoint, {
        headers: this._headers,
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw {
          code: errorBody.code,
          message: errorBody.message ?? "request failed",
          status: res.status,
        };
      }

      return res.json();
    };

    try {
      return await execute();
    } catch (err) {
      return await this.handleTokenExpired(err as ApiError, execute);
    }
  }

  async post(endpoint: string, body: Record<string, FormDataValue>) {
    const execute = async () => {
      const payload = toFormData(body);

      const res = await fetch(`${this._base}/api/` + endpoint, {
        method: "POST",
        headers: this._headers,
        body: payload,
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw {
          code: errorBody.code,
          message: errorBody.message ?? "request failed",
          status: res.status,
        };
      }

      return res.json();
    };

    try {
      return await execute();
    } catch (err) {
      return await this.handleTokenExpired(err as ApiError, execute);
    }
  }
}

const api = new APIClient({
  base: import.meta.env.VITE_API_URL ?? "",
});

export default api;
