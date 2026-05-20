import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import bcrypt from "bcryptjs";
import readline from "readline";

// Load environment based on parameter or default
const env = process.argv[2] || 'dev';

const envFile = env === 'production' ? '.env.production' 
              : env === 'staging' ? '.env.staging' 
              : '.env.local';

dotenv.config({ path: envFile });

const sql = neon(process.env.DATABASE_URL);

const askQuestion = (query) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
}

async function main() {
  console.log(`🌱 Starting Auth Database Seed for Environment: [${env.toUpperCase()}]`);

  if (env === 'production') {
      const confirm = await askQuestion('⚠️ WARNING: You are running a seed script against PRODUCTION. Are you sure? (y/N): ');
      if (confirm.toLowerCase() !== 'y') {
          console.log('Aborting production seed.');
          process.exit(0);
      }
  }

  const tenantSlug = process.env.DEFAULT_TENANT_SLUG;
  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL;
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD;

  if (!tenantSlug || !adminEmail || !adminPassword) {
      console.error("❌ Missing required environment variables: DEFAULT_TENANT_SLUG, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD");
      process.exit(1);
  }

  try {
    // 1. Create a default tenant
    const existingTenant = await sql`SELECT id FROM tenants WHERE slug = ${tenantSlug}`;
    
    let tenantId;
    if (existingTenant.length === 0) {
      console.log(`Creating tenant: ${tenantSlug}...`);
      const insertedTenant = await sql`
        INSERT INTO tenants (name, slug, status, industry)
        VALUES ('Default Tenant', ${tenantSlug}, 'active', 'general')
        RETURNING id
      `;
      tenantId = insertedTenant[0].id;
    } else {
      console.log(`Tenant ${tenantSlug} already exists.`);
      tenantId = existingTenant[0].id;
    }

    // 2. Create the platform admin user
    const existingUser = await sql`SELECT id FROM users WHERE email = ${adminEmail}`;

    if (existingUser.length === 0) {
      console.log(`Creating default admin user: ${adminEmail}...`);
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(adminPassword, salt);

      await sql`
        INSERT INTO users (tenant_id, email, password_hash, name, role, is_active)
        VALUES (${tenantId}, ${adminEmail}, ${passwordHash}, 'Platform Admin', 'platform_admin', true)
      `;
      console.log("✅ Admin user created successfully.");
    } else {
      console.log("✅ Admin user already exists.");
    }

    console.log(`🌱 Seed complete for ${env}!`);

  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

main();
