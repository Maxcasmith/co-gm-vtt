import { getDatabase } from "@/services/Database/Database";

export interface IUserProductRepository {
  create(userId: string, productCode: string): Promise<void>;
  findCodesByUserId(userId: string): Promise<string[]>;
}

// Deliberately not the full Repository<T> shape — user_product is a pure
// join row keyed on (userId, productId), not a single-id entity.
export class UserProductRepository implements IUserProductRepository {
  // Callers (e.g. signup) only know the product's code ('cloud'/'desktop'), not its
  // UUID id — resolve it in the same query rather than round-tripping first.
  async create(userId: string, productCode: string): Promise<void> {
    const db = getDatabase();
    await db.execute(
      "INSERT IGNORE INTO user_product (userId, productId) SELECT ?, id FROM products WHERE code = ?",
      [userId, productCode],
    );
  }

  async findCodesByUserId(userId: string): Promise<string[]> {
    const db = getDatabase();
    const [rows] = await db.execute(
      "SELECT p.code AS code FROM user_product up JOIN products p ON p.id = up.productId WHERE up.userId = ?",
      [userId],
    );
    return (rows as { code: string }[]).map(r => r.code);
  }
}
