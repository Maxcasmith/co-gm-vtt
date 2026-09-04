import { AuthContainer, type IAuthContainer } from "./AuthContainer";

export class Container {
  private static _authContainer: IAuthContainer;

  static get auth() {
    if (!this._authContainer) this._authContainer = new AuthContainer();
    return this._authContainer;
  }
}
