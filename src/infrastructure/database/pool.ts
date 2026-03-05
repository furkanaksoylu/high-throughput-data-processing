import { Pool } from "pg";
import { env } from "../config/env";

export const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASS,
  database: env.DB_NAME,
  max: env.DB_POOL_MAX,
});
