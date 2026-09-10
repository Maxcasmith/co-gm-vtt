export interface CreateUserCommand {
  productId?: string;
  // password path
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  // google path
  googleCode?: string;
  scope?: string;
}
