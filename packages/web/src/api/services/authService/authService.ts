import type z from "zod";
import type { IAPIClient } from "../../client";
import {
  AuthSSOGoogleResponse,
  FindUserResponse,
  type AuthSSOGoogleRequest,
} from "shared";

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
    return data;
  }

  async sessions() {
    const endpoint = "auth/sessions";
    const res = await this.client.get(endpoint);

    return res;
  }

  async revokeSession(sessionId: string) {
    const endpoint = `auth/sessions/${sessionId}/revoke`;
    const res = await this.client.post(endpoint, {});

    return res;
  }

  setTokens(tokens: { access_token: string; refresh_token: string }) {
    const { access_token, refresh_token } = tokens;
    localStorage.setItem(ACCESS_TOKEN, access_token);
    localStorage.setItem(REFRESH_TOKEN, refresh_token);
    this.client.setAccessToken(access_token);
  }

  revokeTokens() {
    localStorage.removeItem(ACCESS_TOKEN);
    localStorage.removeItem(REFRESH_TOKEN);
    this.client.revokeAccessToken();
  }
}
