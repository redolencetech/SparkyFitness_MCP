import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Runs the OAuth migration on startup using the DB owner credentials.
 * Falls back to the app user if no separate migration user is configured.
 * Safe to run multiple times — uses IF NOT EXISTS for all statements.
 */
export async function runMigrations(): Promise<void> {
  const migrationPath = join(__dirname, "migration.sql");
  let sql: string;

  try {
    sql = readFileSync(migrationPath, "utf-8");
  } catch {
    const altPath = join(__dirname, "..", "db", "migration.sql");
    try {
      sql = readFileSync(altPath, "utf-8");
    } catch {
      console.warn("[MCP] migration.sql not found — skipping auto-migration");
      return;
    }
  }

  // Use the DB owner (superuser) for migrations, fall back to app user
  const migrationPool = new Pool({
    host: process.env.SPARKY_FITNESS_DB_HOST,
    port: parseInt(process.env.SPARKY_FITNESS_DB_PORT || "5432", 10),
    database: process.env.SPARKY_FITNESS_DB_NAME,
    user: process.env.SPARKY_FITNESS_DB_OWNER_USER || process.env.SPARKY_FITNESS_DB_USER,
    password: process.env.SPARKY_FITNESS_DB_OWNER_PASSWORD || process.env.SPARKY_FITNESS_DB_PASSWORD,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  const client = await migrationPool.connect();
  try {
    await client.query(sql);
    console.log("[MCP] Migration complete (OAuth tables ensured)");
  } catch (error) {
    console.error("[MCP] Migration failed:", error);
    throw error;
  } finally {
    client.release();
    await migrationPool.end();
  }
}
