import type { Entity } from "@entities/Entity";

export interface UserAuthProviderInterface {
  id?: string;
  userId: string;
  provider: "google" | "facebook" | "x";
  providerUserId: string;
  providerEmail: string;

  // Google-specific tokens (stored encrypted)
  googleAccessToken?: string;
  googleRefreshToken?: string;
  googleTokenExpiresAt?: Date;

  // Facebook-specific tokens (for future use)
  facebookAccessToken?: string;
  facebookTokenExpiresAt?: Date;

  // X-specific tokens (for future use)
  xAccessToken?: string;
  xRefreshToken?: string;
  xTokenExpiresAt?: Date;

  // Track what permissions user granted
  scopes?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export class UserAuthProvider implements Entity {
  private readonly _id: string | undefined;
  private readonly _userId: string;
  private readonly _provider: "google" | "facebook" | "x";
  private readonly _providerUserId: string;
  private readonly _providerEmail: string;
  private readonly _googleAccessToken: string | undefined;
  private readonly _googleRefreshToken: string | undefined;
  private readonly _googleTokenExpiresAt: Date | undefined;
  private readonly _facebookAccessToken: string | undefined;
  private readonly _facebookTokenExpiresAt: Date | undefined;
  private readonly _xAccessToken: string | undefined;
  private readonly _xRefreshToken: string | undefined;
  private readonly _xTokenExpiresAt: Date | undefined;
  private readonly _scopes: string | undefined;
  private readonly _createdAt: Date | undefined;
  private readonly _updatedAt: Date | undefined;

  constructor({
    id,
    userId,
    provider,
    providerUserId,
    providerEmail,
    googleAccessToken,
    googleRefreshToken,
    googleTokenExpiresAt,
    facebookAccessToken,
    facebookTokenExpiresAt,
    xAccessToken,
    xRefreshToken,
    xTokenExpiresAt,
    scopes,
    createdAt,
    updatedAt,
  }: UserAuthProviderInterface) {
    this._id = id;
    this._userId = userId;
    this._provider = provider;
    this._providerUserId = providerUserId;
    this._providerEmail = providerEmail;
    this._googleAccessToken = googleAccessToken;
    this._googleRefreshToken = googleRefreshToken;
    this._googleTokenExpiresAt = googleTokenExpiresAt;
    this._facebookAccessToken = facebookAccessToken;
    this._facebookTokenExpiresAt = facebookTokenExpiresAt;
    this._xAccessToken = xAccessToken;
    this._xRefreshToken = xRefreshToken;
    this._xTokenExpiresAt = xTokenExpiresAt;
    this._scopes = scopes;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
  }

  get id() {
    return this._id;
  }

  get userId() {
    return this._userId;
  }

  get provider() {
    return this._provider;
  }

  get providerUserId() {
    return this._providerUserId;
  }

  get providerEmail() {
    return this._providerEmail;
  }

  get googleAccessToken() {
    return this._googleAccessToken;
  }

  get googleRefreshToken() {
    return this._googleRefreshToken;
  }

  get googleTokenExpiresAt() {
    return this._googleTokenExpiresAt;
  }

  get facebookAccessToken() {
    return this._facebookAccessToken;
  }

  get facebookTokenExpiresAt() {
    return this._facebookTokenExpiresAt;
  }

  get xAccessToken() {
    return this._xAccessToken;
  }

  get xRefreshToken() {
    return this._xRefreshToken;
  }

  get xTokenExpiresAt() {
    return this._xTokenExpiresAt;
  }

  get scopes() {
    return this._scopes;
  }

  get createdAt() {
    return this._createdAt;
  }

  get updatedAt() {
    return this._updatedAt;
  }

  present() {
    return {
      id: this.id,
      userId: this.userId,
      provider: this.provider,
      providerUserId: this.providerUserId,
      providerEmail: this.providerEmail,
      scopes: this.scopes,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
