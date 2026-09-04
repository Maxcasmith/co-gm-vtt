import { RefreshTokenFactory } from "@entities/RefreshToken/RefreshTokenFactory";
import type { RefreshToken } from "@entities/RefreshToken/RefreshToken";
import type {
  DeleteDTOInterface,
  ListDTOInterface,
  Repository,
  UpdateDTOInterface,
} from "@repositories/Repository";
import { getDatabase } from "@/services/Database/Database";
import { randomUUID } from "crypto";

export interface IRefreshTokenRepository extends Repository<RefreshToken> {
  findByToken(token: string): Promise<RefreshToken | null>;
  findActiveByUserId(userId: string): Promise<RefreshToken[]>;
  findTokenChain(tokenId: string): Promise<RefreshToken[]>;
  revokeTokenChain(tokenId: string): Promise<void>;
  cleanupExpired(): Promise<void>;
}

export class RefreshTokenRepository implements IRefreshTokenRepository {
  async find(blueprints: Partial<RefreshToken>): Promise<RefreshToken | null> {
    const db = getDatabase();
    const conditions: string[] = [];
    const values: any[] = [];

    if (blueprints.id) {
      conditions.push("id = ?");
      values.push(blueprints.id);
    }
    if (blueprints.refreshToken) {
      conditions.push("refreshToken = ?");
      values.push(blueprints.refreshToken);
    }
    if (blueprints.userId) {
      conditions.push("userId = ?");
      values.push(blueprints.userId);
    }

    if (conditions.length === 0) {
      return null;
    }

    const query = `SELECT * FROM refresh_tokens WHERE ${conditions.join(" AND ")} LIMIT 1`;
    const [rows] = await db.execute(query, values);
    const tokens = rows as any[];

    if (tokens.length === 0) {
      return null;
    }

    return RefreshTokenFactory.create(tokens[0]);
  }

  async list(blueprints: ListDTOInterface): Promise<RefreshToken[]> {
    const db = getDatabase();
    const { maximum = 10, offset = 0 } = blueprints;

    const query = `SELECT * FROM refresh_tokens LIMIT ? OFFSET ?`;
    const [rows] = await db.execute(query, [maximum, offset]);
    const tokens = rows as any[];

    return tokens.map((row) => RefreshTokenFactory.create(row));
  }

  async create(blueprints: RefreshToken): Promise<RefreshToken> {
    const db = getDatabase();
    const id = randomUUID();

    const query = `
      INSERT INTO refresh_tokens (
        id, userId, refreshToken, predecessorId, expiresAt, inactive, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    await db.execute(query, [
      id,
      blueprints.userId,
      blueprints.refreshToken,
      blueprints.predecessorId || null,
      blueprints.expiresAt,
      blueprints.inactive || false,
    ]);

    const token = await this.find({ id });
    if (!token) {
      throw new Error("Failed to create refresh token");
    }

    return token;
  }

  async update(
    blueprints: UpdateDTOInterface<RefreshToken>,
  ): Promise<RefreshToken> {
    const db = getDatabase();
    const updates: string[] = [];
    const values: any[] = [];

    if (blueprints.data.inactive !== undefined) {
      updates.push("inactive = ?");
      values.push(blueprints.data.inactive);
    }
    if (blueprints.data.expiresAt !== undefined) {
      updates.push("expiresAt = ?");
      values.push(blueprints.data.expiresAt);
    }

    if (updates.length === 0) {
      const token = await this.find({ id: blueprints.id });
      if (!token) {
        throw new Error("Refresh token not found");
      }
      return token;
    }

    updates.push("updatedAt = NOW()");
    values.push(blueprints.id);

    const query = `UPDATE refresh_tokens SET ${updates.join(", ")} WHERE id = ?`;
    await db.execute(query, values);

    const token = await this.find({ id: blueprints.id });
    if (!token) {
      throw new Error("Refresh token not found after update");
    }

    return token;
  }

  async delete(blueprints: DeleteDTOInterface): Promise<boolean> {
    const db = getDatabase();
    const query = `DELETE FROM refresh_tokens WHERE id = ?`;
    const [result] = await db.execute(query, [blueprints.id]);
    const deleteResult = result as any;

    return deleteResult.affectedRows > 0;
  }

  async findByToken(token: string): Promise<RefreshToken | null> {
    const db = getDatabase();
    const query = `
      SELECT * FROM refresh_tokens
      WHERE refreshToken = ?
      LIMIT 1
    `;
    const [rows] = await db.execute(query, [token]);
    const tokens = rows as any[];

    if (tokens.length === 0) {
      return null;
    }

    return RefreshTokenFactory.create(tokens[0]);
  }

  async findActiveByUserId(userId: string): Promise<RefreshToken[]> {
    const db = getDatabase();
    const query = `
      SELECT * FROM refresh_tokens
      WHERE userId = ?
      AND inactive = FALSE
      AND expiresAt > NOW()
      ORDER BY createdAt DESC
    `;
    const [rows] = await db.execute(query, [userId]);
    const tokens = rows as any[];

    return tokens.map((row) => RefreshTokenFactory.create(row));
  }

  async findTokenChain(tokenId: string): Promise<RefreshToken[]> {
    const db = getDatabase();

    // Use recursive CTE to find entire chain (predecessors and successors)
    const query = `
      WITH RECURSIVE token_chain AS (
        -- Start with the given token
        SELECT * FROM refresh_tokens WHERE id = ?

        UNION ALL

        -- Get all predecessors (walk backwards)
        SELECT rt.*
        FROM refresh_tokens rt
        INNER JOIN token_chain tc ON rt.id = tc.predecessorId

        UNION ALL

        -- Get all successors (walk forwards)
        SELECT rt.*
        FROM refresh_tokens rt
        INNER JOIN token_chain tc ON rt.predecessorId = tc.id
      )
      SELECT DISTINCT * FROM token_chain
    `;

    const [rows] = await db.execute(query, [tokenId]);
    const tokens = rows as any[];

    return tokens.map((row) => RefreshTokenFactory.create(row));
  }

  async revokeTokenChain(tokenId: string): Promise<void> {
    const db = getDatabase();

    // First get all tokens in the chain
    const chainTokens = await this.findTokenChain(tokenId);

    if (chainTokens.length === 0) {
      return;
    }

    // Delete all from chain
    const tokenIds = chainTokens.map((t) => t.id!);
    const placeholders = tokenIds.map(() => "?").join(",");

    const query = `
      DELETE FROM refresh_tokens
      WHERE id IN (${placeholders})
    `;

    await db.execute(query, tokenIds);
  }

  async cleanupExpired(): Promise<void> {
    const db = getDatabase();

    // Delete expired tokens
    await db.execute(`
      DELETE FROM refresh_tokens
      WHERE expiresAt < NOW()
    `);

    // Delete inactive tokens older than 7 days
    await db.execute(`
      DELETE FROM refresh_tokens
      WHERE inactive = TRUE
      AND updatedAt < DATE_SUB(NOW(), INTERVAL 7 DAY)
    `);
  }
}
