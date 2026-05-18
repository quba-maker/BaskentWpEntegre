import { sql } from './src/lib/db';
async function run() {
  const settings = await sql`SELECT * FROM bot_settings WHERE key = 'system_prompt_whatsapp' LIMIT 1;`;
  console.log("PROMPT:", settings[0]?.value);
  process.exit(0);
}
run();
