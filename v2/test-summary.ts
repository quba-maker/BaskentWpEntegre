import fs from 'fs';
import path from 'path';

// Parse .env.development.local manually
const envPath = path.resolve(process.cwd(), '.env.development.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      process.env[key] = val;
    }
  });
}

import { sql } from './src/lib/db';

async function run() {
  const phone = '905546833306';
  const rows = await sql`
    SELECT conversation_id, summary_text, buying_intent, sentiment, updated_at 
    FROM conversation_memory 
    WHERE conversation_id = ${phone} OR conversation_id LIKE '%' || ${phone} || '%'
    LIMIT 5;
  `;
  console.log("DATABASE MEMORY ROWS:", JSON.stringify(rows, null, 2));
  process.exit(0);
}

run().catch(err => {
  console.error("DB Error:", err);
  process.exit(1);
});
