import { UserAuthProviderFactory } from "@entities/UserAuthProvider/UserAuthProviderFactory";
import type { UserAuthProvider } from "@entities/UserAuthProvider/UserAuthProvider";
import type {
  DeleteDTOInterface,
  ListDTOInterface,
  Repository,
  UpdateDTOInterface,
} from "@repositories/Repository";
import { getDatabase } from "@/services/Database/Database";
import { randomUUID } from "crypto";

export interface IUserAuthProviderRepository extends Repository<UserAuthProvider> {
  findByProviderAndUserId(
    provider: string,
    providerUserId: string,
  ): Promise<UserAuthProvider | null>;
  findByUserId(userId: string): Promise<UserAuthProvider[]>;
  upsert(data: any): Promise<UserAuthProvider>;
}

export class UserAuthProviderRepository implements IUserAuthProviderRepository {
  async find(
    blueprints: Partial<UserAuthProvider>,
  ): Promise<UserAuthProvider | null> {
    const db = getDatabase();
    const conditions: string[] = [];
    const values: any[] = [];

    if (blueprints.id) {
      conditions.push("id = ?");
      values.push(blueprints.id);
    }
    if (blueprints.provider) {
      conditions.push("provider = ?");
      values.push(blueprints.provider);
    }
    if (blueprints.providerUserId) {
      conditions.push("providerUserId = ?");
      values.push(blueprints.providerUserId);
    }
    if (blueprints.userId) {
      conditions.push("userId = ?");
      values.push(blueprints.userId);
    }

    if (conditions.length === 0) {
      return null;
    }

    const query = `SELECT * FROM user_auth_providers WHERE ${conditions.join(" AND ")} LIMIT 1`;
    const [rows] = await db.execute(query, values);
    const providers = rows as any[];

    if (providers.length === 0) {
      return null;
    }

    return UserAuthProviderFactory.create(providers[0]);
  }

  async list(blueprints: ListDTOInterface): Promise<UserAuthProvider[]> {
    const db = getDatabase();
    const { maximum = 10, offset = 0 } = blueprints;

    const query = `SELECT * FROM user_auth_providers LIMIT ? OFFSET ?`;
    const [rows] = await db.execute(query, [maximum, offset]);
    const providers = rows as any[];

    return providers.map((row) => UserAuthProviderFactory.create(row));
  }

  async create(
    blueprints: Partial<UserAuthProvider>,
  ): Promise<UserAuthProvider> {
    const db = getDatabase();
    const id = randomUUID();

    const query = `
      INSERT INTO user_auth_providers (
        id, userId, provider, providerUserId, providerEmail,
        googleAccessToken, googleRefreshToken, googleTokenExpiresAt,
        scopes, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    await db.execute(query, [
      id,
      blueprints.userId ?? null,
      blueprints.provider ?? null,
      blueprints.providerUserId ?? null,
      blueprints.providerEmail ?? null,
      blueprints.googleAccessToken ?? null,
      blueprints.googleRefreshToken ?? null,
      blueprints.googleTokenExpiresAt ?? null,
      blueprints.scopes ?? null,
    ]);

    const provider = await this.find({ id });
    if (!provider) {
      throw new Error("Failed to create user auth provider");
    }

    return provider;
  }

  async update(
    blueprints: UpdateDTOInterface<UserAuthProvider>,
  ): Promise<UserAuthProvider> {
    const db = getDatabase();
    const updates: string[] = [];
    const values: any[] = [];

    if (blueprints.data.googleAccessToken !== undefined) {
      updates.push("googleAccessToken = ?");
      values.push(blueprints.data.googleAccessToken);
    }
    if (blueprints.data.googleRefreshToken !== undefined) {
      updates.push("googleRefreshToken = ?");
      values.push(blueprints.data.googleRefreshToken);
    }
    if (blueprints.data.googleTokenExpiresAt !== undefined) {
      updates.push("googleTokenExpiresAt = ?");
      values.push(blueprints.data.googleTokenExpiresAt);
    }
    if (blueprints.data.scopes !== undefined) {
      updates.push("scopes = ?");
      values.push(blueprints.data.scopes);
    }

    if (updates.length === 0) {
      const provider = await this.find({ id: blueprints.id });
      if (!provider) {
        throw new Error("User auth provider not found");
      }
      return provider;
    }

    updates.push("updatedAt = NOW()");
    values.push(blueprints.id);

    const query = `UPDATE user_auth_providers SET ${updates.join(", ")} WHERE id = ?`;
    await db.execute(query, values);

    const provider = await this.find({ id: blueprints.id });
    if (!provider) {
      throw new Error("User auth provider not found after update");
    }

    return provider;
  }

  async delete(blueprints: DeleteDTOInterface): Promise<boolean> {
    const db = getDatabase();
    const query = `DELETE FROM user_auth_providers WHERE id = ?`;
    const [result] = await db.execute(query, [blueprints.id]);
    const deleteResult = result as any;

    return deleteResult.affectedRows > 0;
  }

  async findByProviderAndUserId(
    provider: "google" | "facebook" | "x",
    providerUserId: string,
  ): Promise<UserAuthProvider | null> {
    return await this.find({ provider, providerUserId });
  }

  async findByUserId(userId: string): Promise<UserAuthProvider[]> {
    const db = getDatabase();
    const query = `SELECT * FROM user_auth_providers WHERE userId = ?`;
    const [rows] = await db.execute(query, [userId]);
    const providers = rows as any[];

    return providers.map((row) => UserAuthProviderFactory.create(row));
  }

  async upsert(data: any): Promise<UserAuthProvider> {
    const db = getDatabase();

    const existing = await this.findByProviderAndUserId(
      data.provider,
      data.providerUserId,
    );

    if (existing) {
      const query = `
        UPDATE user_auth_providers
        SET
          googleAccessToken = ?,
          googleRefreshToken = ?,
          googleTokenExpiresAt = ?,
          scopes = ?,
          updatedAt = NOW()
        WHERE provider = ? AND providerUserId = ?
      `;

      await db.execute(query, [
        data.googleAccessToken ?? null,
        data.googleRefreshToken ?? null,
        data.googleTokenExpiresAt ?? null,
        data.scopes ?? null,
        data.provider,
        data.providerUserId,
      ]);

      const updated = await this.findByProviderAndUserId(
        data.provider,
        data.providerUserId,
      );

      if (!updated) {
        throw new Error("Failed to update user auth provider");
      }

      return updated;
    } else {
      return await this.create(data);
    }
  }
}
