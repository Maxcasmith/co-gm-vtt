import {
  UserAuthProvider,
  type UserAuthProviderInterface,
} from "./UserAuthProvider";

export class UserAuthProviderFactory {
  static create(data: UserAuthProviderInterface): UserAuthProvider {
    return new UserAuthProvider(data);
  }

  static createForTest(): UserAuthProvider {
    return new UserAuthProvider({
      id: "test-uap-id",
      userId: "test-user-id",
      provider: "google",
      providerUserId: "google-123456789",
      providerEmail: "test@example.com",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
