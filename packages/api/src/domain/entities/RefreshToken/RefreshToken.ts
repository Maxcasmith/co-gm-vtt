import type { Entity } from "@entities/Entity";

export interface RefreshTokenInterface {
  id?: string;
  userId: string;
  refreshToken: string;
  predecessorId?: string | null;
  expiresAt: Date;
  inactive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export class RefreshToken implements Entity {
  private readonly _id: string | undefined;
  private readonly _userId: string;
  private readonly _refreshToken: string;
  private readonly _predecessorId: string | null | undefined;
  private readonly _expiresAt: Date;
  private readonly _inactive: boolean;
  private readonly _createdAt: Date | undefined;
  private readonly _updatedAt: Date | undefined;

  constructor({
    id,
    userId,
    refreshToken,
    predecessorId,
    expiresAt,
    inactive,
    createdAt,
    updatedAt,
  }: RefreshTokenInterface) {
    this._id = id;
    this._userId = userId;
    this._refreshToken = refreshToken;
    this._predecessorId = predecessorId;
    this._expiresAt = expiresAt;
    this._inactive = inactive;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
  }

  get id() {
    return this._id;
  }

  get userId() {
    return this._userId;
  }

  get refreshToken() {
    return this._refreshToken;
  }

  get predecessorId() {
    return this._predecessorId;
  }

  get expiresAt() {
    return this._expiresAt;
  }

  get inactive() {
    return this._inactive;
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
      predecessorId: this.predecessorId,
      expiresAt: this.expiresAt,
      inactive: this.inactive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
