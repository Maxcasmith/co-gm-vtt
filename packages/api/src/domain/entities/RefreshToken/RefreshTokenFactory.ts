import { RefreshToken, type RefreshTokenInterface } from "./RefreshToken";

export class RefreshTokenFactory {
  static create(data: RefreshTokenInterface): RefreshToken {
    return new RefreshToken(data);
  }

  static createForTest(): RefreshToken {
    return new RefreshToken({
      id: "test-refresh-token-id",
      userId: "test-user-id",
      refreshToken: "test-refresh-token-value",
      predecessorId: null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      inactive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
