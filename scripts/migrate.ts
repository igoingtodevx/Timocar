import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { sanitizeDatabaseConnectionString } from "../api/admin-store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = path.join(here, "../db/migrations/001_operator_dashboard.sql");
const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  throw new Error("DATABASE_URL is required to run database migrations.");
}

const client = new Client({
  connectionString: sanitizeDatabaseConnectionString(connectionString),
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(await readFile(migration, "utf8"));
  console.log("Operator dashboard migration applied successfully.");
} finally {
  await client.end().catch(() => undefined);
}
