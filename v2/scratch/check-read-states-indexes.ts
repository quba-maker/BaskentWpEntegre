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
        AND tablename = 'conversation_read_states'
    ORDER BY
        indexname;
  `;
  
  console.dir(indexes, { depth: null });
  
  process.exit(0);
}

run().catch(console.error);
