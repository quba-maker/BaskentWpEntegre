import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function checkHealth() {
  console.log("🩺 Running pre-build Auth Health Check...");

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret === "fallback_secret_for_build_only") {
    console.warn("⚠️ WARNING: AUTH_SECRET is missing or using fallback. Production auth will fail or be insecure.");
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ ERROR: DATABASE_URL is missing.");
    process.exit(1);
  }

  try {
    const sql = neon(dbUrl);
    
    // Check if tables exist and have data
    const tenants = await sql`SELECT count(*) as count FROM tenants`;
    if (parseInt(tenants[0].count) === 0) {
      console.warn("⚠️ WARNING: The 'tenants' table is empty. Nobody can log in.");
    }

    const users = await sql`SELECT count(*) as count FROM users`;
    if (parseInt(users[0].count) === 0) {
      console.warn("⚠️ WARNING: The 'users' table is empty. Nobody can log in.");
    }

    console.log("✅ Health Check passed.");
  } catch (error) {
    console.error("❌ Database connectivity or schema error:", error.message);
    console.log("⚠️ If building in CI/CD without DB access, this is expected.");
  }
}

checkHealth();
