import type { IAPIClient } from "../../client";

export class OnboardingService {
  private readonly _client: IAPIClient;

  constructor(client: IAPIClient) {
    this._client = client;
  }

  async submit(payload: object) {
    const endpoint = "onboarding/submit";
    const res = await this._client.post(endpoint, payload);

    return res;
  }

  async customerVariant(payload: object) {
    const endpoint = "onboarding/variant";
    const res = await this._client.post(endpoint, payload);

    return res;
  }
}
