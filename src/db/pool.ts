import pg from "pg";
import { DB_POOL_MAX, DB_IDLE_TIMEOUT_MS, DB_CONNECTION_TIMEOUT_MS } from "../constants.js";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.SPARKY_FITNESS_DB_HOST,
  port: parseInt(process.env.SPARKY_FITNESS_DB_PORT || "5432", 10),
  database: process.env.SPARKY_FITNESS_DB_NAME,
  user: process.env.SPARKY_FITNESS_DB_USER,
  password: process.env.SPARKY_FITNESS_DB_PASSWORD,
  max: DB_POOL_MAX,
  idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
});

export { pool };
export default pool;
