import type { Entity } from "@entities/Entity";

export interface UserInterface {
  id?: string | undefined;
  firstName: string;
  lastName: string;
  email: string;
  mobile?: string | undefined;
  password?: string | null | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}

export class User implements Entity {
  private readonly _id: string | undefined;
  private readonly _firstName: string;
  private readonly _lastName: string;
  private readonly _email: string;
  private readonly _mobile: string | undefined;
  private readonly _password: string | null | undefined;
  private readonly _createdAt: Date | undefined;
  private readonly _updatedAt: Date | undefined;

  constructor({
    id,
    firstName,
    lastName,
    email,
    mobile,
    password,
    createdAt,
    updatedAt,
  }: UserInterface) {
    this._id = id;
    this._firstName = firstName;
    this._lastName = lastName;
    this._email = email;
    this._mobile = mobile;
    this._password = password;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
  }

  get id() {
    return this._id;
  }

  get firstName() {
    return this._firstName;
  }

  get lastName() {
    return this._lastName;
  }

  get email() {
    return this._email;
  }

  get mobile() {
    return this._mobile;
  }

  get password() {
    return this._password;
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
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      mobile: this.mobile,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
