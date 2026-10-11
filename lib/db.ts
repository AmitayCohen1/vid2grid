import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/* The analytics store (schema: scripts/db-schema.sql). Server code only. */
let client: NeonQueryFunction<false, false> | null = null;
export function sql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}
