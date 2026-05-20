import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import bcrypt from "bcryptjs";

dotenv.config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log("🌱 Starting Auth Database Seed...");

  try {
    // 1. Create a default tenant
    const tenantSlug = "baskent";
    const existingTenant = await sql`SELECT id FROM tenants WHERE slug = ${tenantSlug}`;
    
    let tenantId;
    if (existingTenant.length === 0) {
      console.log("Creating default tenant...");
      const insertedTenant = await sql`
        INSERT INTO tenants (name, slug, status, industry)
        VALUES ('Başkent Üniversitesi', ${tenantSlug}, 'active', 'education')
        RETURNING id
      `;
      tenantId = insertedTenant[0].id;
    } else {
      console.log("Default tenant already exists.");
      tenantId = existingTenant[0].id;
    }

    // 2. Create the platform admin user
    const adminEmail = "admin@qubamedya.com";
    const existingUser = await sql`SELECT id FROM users WHERE email = ${adminEmail}`;

    if (existingUser.length === 0) {
      console.log("Creating default admin user...");
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash("Quba123!", salt);

      await sql`
        INSERT INTO users (tenant_id, email, password_hash, name, role, is_active)
        VALUES (${tenantId}, ${adminEmail}, ${passwordHash}, 'Platform Admin', 'platform_admin', true)
      `;
      console.log("✅ Admin user created successfully.");
    } else {
      console.log("✅ Admin user already exists.");
    }

    console.log("🌱 Seed complete!");

  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

main();
