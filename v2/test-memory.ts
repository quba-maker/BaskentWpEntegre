import { sql } from "./src/lib/db";

async function run() {
  const phone = '905546833306';
  const mem = await sql`SELECT * FROM conversation_memory WHERE conversation_id = (SELECT id FROM conversations WHERE phone_number = ${phone} LIMIT 1)`;
  console.log("Memory in DB:", mem);
  
  const msgs = await sql`SELECT content, direction, created_at FROM messages WHERE phone_number = ${phone} ORDER BY created_at DESC LIMIT 10`;
  console.log("Latest 10 messages:", msgs);
  
  process.exit(0);
}
run();
