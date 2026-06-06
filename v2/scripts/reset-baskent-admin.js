require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");
const bcrypt = require("bcryptjs");

async function run() {
  console.log("--- Resetting admin@baskent.com Password ---");
  const sql = neon(process.env.DATABASE_URL);
  
  const users = await sql`SELECT id FROM users WHERE email = 'admin@baskent.com'`;
  if (users.length === 0) {
    console.error("User admin@baskent.com not found!");
    return;
  }
  
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash("admin1234", salt);
  
  await sql`UPDATE users SET password_hash = ${hash} WHERE email = 'admin@baskent.com'`;
  console.log("✅ Password successfully reset to 'admin1234'");
}
run();
