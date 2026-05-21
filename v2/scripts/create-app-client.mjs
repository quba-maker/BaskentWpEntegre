import { Pool } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const password = "AppClientSuperSecurePassword123!@#_2026";
  try {
    await pool.query(`DROP ROLE IF EXISTS app_client`);
    await pool.query(`CREATE ROLE app_client LOGIN PASSWORD '${password}'`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO app_client`);
    await pool.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_client`);
    await pool.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_client`);
    await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO app_client`);
    await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO app_client`);
    console.log("app_client role created successfully.");
    
    // Check bypassrls
    const r = await pool.query(`SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_client'`);
    console.log(r.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

main();
