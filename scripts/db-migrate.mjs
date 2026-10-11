// Applies scripts/db-schema.sql to DATABASE_URL (idempotent).
//   node --env-file=.env.local scripts/db-migrate.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
const sql = neon(url);
const statements = readFileSync(new URL("./db-schema.sql", import.meta.url), "utf8")
  .split(/;\s*$/m).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
for (const s of statements) { await sql.query(s); console.log("ok:", s.split("\n")[0]); }
