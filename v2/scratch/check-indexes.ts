import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL;

async function run() {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(DATABASE_URL!);
  
  const indexes = await sql`
    SELECT
        tablename,
        indexname,
        indexdef
    FROM
        pg_indexes
    WHERE
        schemaname = 'public'
        AND tablename IN ('messages', 'conversations', 'leads')
    ORDER BY
        tablename, indexname;
  `;
  
  console.log("Indexes on messages, conversations, and leads:");
  console.dir(indexes, { depth: null });
  
  process.exit(0);
}

run().catch(console.error);
