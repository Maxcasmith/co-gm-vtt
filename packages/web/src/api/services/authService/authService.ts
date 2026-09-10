import type z from "zod";
import type { IAPIClient } from "../../client";
import {
  AuthSSOGoogleResponse,
  FindUserResponse,
  GetSessionsResponse,
  type AuthSSOGoogleRequest,
  type AuthSignupRequest,
  type AuthLoginRequest,
  type ChangePasswordRequest,
} from "shared";
import { writeUserSession, clearUserSession } from "../../userSession";

const ACCESS_TOKEN = "access_token";
const REFRESH_TOKEN = "refresh_token";

export class AuthService {
  private readonly client: IAPIClient;

  constructor(client: IAPIClient) {
    this.client = client;
  }

  async ssoGoogle(payload: z.infer<typeof AuthSSOGoogleRequest>) {
    const endpoint = "auth/google/signin";
    const res = await this.client.post(endpoint, payload);

    const data = AuthSSOGoogleResponse.parse(res);
    this.setTokens(data);

    return data;
  }

  async signup(payload: z.infer<typeof AuthSignupRequest>) {
    const endpoint = "auth/signup";
    const res = await this.client.post(endpoint, payload);

    const data = AuthSSOGoogleResponse.parse(res);
    this.setTokens(data);

    return data;
  }

  async login(payload: z.infer<typeof AuthLoginRequest>) {
    const endpoint = "auth/login";
    const res = await this.client.post(endpoint, payload);

    const data = AuthSSOGoogleResponse.parse(res);
    this.setTokens(data);

    return data;
  }

  async refreshToken() {
    const endpoint = "auth/refresh";
    const refresh_token = localStorage.getItem(REFRESH_TOKEN);

    const res = await this.client.post(endpoint, { refresh_token });
    const data = AuthSSOGoogleResponse.parse(res);
    this.setTokens(data);

    return data;
  }

  async me() {
    const endpoint = "users/me";
    const res = await this.client.get(endpoint);

    const data = FindUserResponse.parse(res);
    writeUserSession(data);
    return data;
  }

  async sessions() {
    const endpoint = "auth/sessions";
    const res = await this.client.get(endpoint);

    return GetSessionsResponse.parse(res).sessions;
  }

  async revokeSession(sessionId: string) {
    const endpoint = `auth/sessions/${sessionId}/revoke`;
    await this.client.post(endpoint, {});
  }

  async changePassword(payload: z.infer<typeof ChangePasswordRequest>) {
    const endpoint = "auth/change-password";
    await this.client.post(endpoint, payload);
  }

  setTokens(tokens: { access_token: string; refresh_token: string }) {
    const { access_token, refresh_token } = tokens;
    localStorage.setItem(ACCESS_TOKEN, access_token);
    localStorage.setItem(REFRESH_TOKEN, refresh_token);
    this.client.setAccessToken(access_token);
    // New tokens can mean a different account in the same tab — drop any cached identity.
    clearUserSession();
  }

  revokeTokens() {
    localStorage.removeItem(ACCESS_TOKEN);
    localStorage.removeItem(REFRESH_TOKEN);
    this.client.revokeAccessToken();
    clearUserSession();
  }
}
