import { User, type UserInterface } from "./User";

export class UserFactory {
  static create(dto: UserInterface) {
    return new User({
      id: dto.id,
      firstName: dto.firstName,
      lastName: dto.lastName,
      mobile: dto.mobile,
      email: dto.email,
      createdAt: dto.createdAt,
      updatedAt: dto.updatedAt,
    });
  }

  static createWithId(dto: Omit<UserInterface, "id">) {
    return new User({
      id: crypto.randomUUID(),
      firstName: dto.firstName,
      lastName: dto.lastName,
      mobile: dto.mobile,
      email: dto.email,
    });
  }

  static createUserForTest(dto?: Omit<UserInterface, "id">) {
    return new User({
      id: "123-123-123-123-123",
      firstName: dto?.firstName ?? "Test",
      lastName: dto?.lastName ?? "Testerson",
      mobile: dto?.mobile ?? "11111111111",
      email: dto?.email ?? "test@test.com",
    });
  }
}
