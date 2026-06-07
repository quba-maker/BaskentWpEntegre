import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL;

async function run() {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(DATABASE_URL!);
  
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `;
  
  console.log("All tables in database:");
  console.dir(tables);
  
  process.exit(0);
}

run().catch(console.error);
