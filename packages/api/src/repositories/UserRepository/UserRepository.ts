import { UserFactory } from "@entities/User/UserFactory";
import type { User } from "@entities/User/User";
import type {
  DeleteDTOInterface,
  ListDTOInterface,
  Repository,
  UpdateDTOInterface,
} from "@repositories/Repository";
import { getDatabase } from "@/services/Database/Database";
import { randomUUID } from "crypto";

export interface IUserRepository extends Repository<User> {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
}

export class UserRepository implements IUserRepository {
  async find(blueprints: Partial<User>) {
    const db = getDatabase();
    const conditions: string[] = [];
    const values: any[] = [];

    if (blueprints.id) {
      conditions.push("id = ?");
      values.push(blueprints.id);
    }
    if (blueprints.email) {
      conditions.push("email = ?");
      values.push(blueprints.email);
    }

    if (conditions.length === 0) {
      return null;
    }

    const query = `SELECT * FROM users WHERE ${conditions.join(" AND ")} LIMIT 1`;
    const [rows] = await db.execute(query, values);
    const users = rows as any[];

    if (users.length === 0) {
      return null;
    }

    return UserFactory.create(users[0]);
  }

  async list(blueprints: ListDTOInterface) {
    const db = getDatabase();
    const { maximum = 10, offset = 0 } = blueprints;

    const query = `SELECT * FROM users LIMIT ? OFFSET ?`;
    const [rows] = await db.execute(query, [maximum, offset]);
    const users = rows as any[];

    return users.map((row) => UserFactory.create(row));
  }

  async create(blueprints: User) {
    const db = getDatabase();
    const id = randomUUID();

    const query = `
      INSERT INTO users (id, email, firstName, lastName, mobile, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW())
    `;

    await db.execute(query, [
      id,
      blueprints.email,
      blueprints.firstName,
      blueprints.lastName,
      blueprints.mobile || null,
    ]);

    const user = await this.findById(id);
    if (!user) {
      throw new Error("Failed to create user");
    }

    return user;
  }

  async update(blueprints: UpdateDTOInterface<User>) {
    const db = getDatabase();
    const updates: string[] = [];
    const values: any[] = [];

    if (blueprints.data.email) {
      updates.push("email = ?");
      values.push(blueprints.data.email);
    }
    if (blueprints.data.firstName) {
      updates.push("firstName = ?");
      values.push(blueprints.data.firstName);
    }
    if (blueprints.data.lastName) {
      updates.push("lastName = ?");
      values.push(blueprints.data.lastName);
    }
    if (blueprints.data.mobile !== undefined) {
      updates.push("mobile = ?");
      values.push(blueprints.data.mobile);
    }

    if (updates.length === 0) {
      const user = await this.findById(blueprints.id);
      if (!user) {
        throw new Error("User not found");
      }
      return user;
    }

    updates.push("updatedAt = NOW()");
    values.push(blueprints.id);

    const query = `UPDATE users SET ${updates.join(", ")} WHERE id = ?`;
    await db.execute(query, values);

    const user = await this.findById(blueprints.id);
    if (!user) {
      throw new Error("User not found after update");
    }

    return user;
  }

  async delete(blueprints: DeleteDTOInterface) {
    const db = getDatabase();
    const query = `DELETE FROM users WHERE id = ?`;
    const [result] = await db.execute(query, [blueprints.id]);
    const deleteResult = result as any;

    return deleteResult.affectedRows > 0;
  }

  async findByEmail(email: string): Promise<User | null> {
    return await this.find({ email });
  }

  async findById(id: string): Promise<User | null> {
    return await this.find({ id });
  }
}
