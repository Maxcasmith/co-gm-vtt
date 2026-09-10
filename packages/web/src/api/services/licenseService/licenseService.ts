import type { IAPIClient } from "../../client";
import { GetLicenseResponse } from "shared";

export class LicenseService {
  private readonly client: IAPIClient;

  constructor(client: IAPIClient) {
    this.client = client;
  }

  async mine() {
    const endpoint = "licenses/mine";
    const res = await this.client.get(endpoint);

    return GetLicenseResponse.parse(res).licenseCode;
  }
}
