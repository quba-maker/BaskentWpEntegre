import { sql } from '../src/lib/db';

async function main() {
  const columns = await sql`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'conversation_memory'
  `;
  console.log(JSON.stringify(columns, null, 2));
  process.exit(0);
}

main().catch(console.error);
