import { generateUuidV7 } from "@smb-os/domain";
import { eq } from "drizzle-orm";
import type { Connection } from "../connection.js";
import { users } from "../schema/sqlite.js";

export interface User {
  id: string;
  email: string;
  externalAuthId: string | null;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
}

export interface CreateUserInput {
  email: string;
  externalAuthId?: string;
  status: User["status"];
  createdAt: string;
}

/**
 * `users` has no `merchant_id` column — a single identity can hold a role
 * in more than one merchant (`docs/design/03`), so this is a plain
 * repository, not a `TenantScopedRepository`. Tenant scoping for
 * merchant-facing access lives one layer up, in `MerchantUserRepository`.
 */
export class UserRepository {
  constructor(private readonly conn: Connection) {}

  create(input: CreateUserInput): string {
    const id = generateUuidV7();
    this.conn.db
      .insert(users)
      .values({ id, ...input })
      .run();
    return id;
  }

  findById(id: string): User | undefined {
    return this.conn.db.select().from(users).where(eq(users.id, id)).get() as
      | User
      | undefined;
  }

  findByEmail(email: string): User | undefined {
    return this.conn.db.select().from(users).where(eq(users.email, email)).get() as
      | User
      | undefined;
  }
}
