import * as path from 'path';
import * as fs from 'fs';
import { parse } from 'dotenv';

const files = [
  '.env.production.local',
  '.env.local',
  '.env',
  '../.env.local'
];

for (const f of files) {
  const p = path.join(__dirname, '../', f);
  if (fs.existsSync(p)) {
    const content = fs.readFileSync(p, 'utf-8');
    const parsed = parse(content);
    console.log(`--- File: ${f} ---`);
    console.log(`DATABASE_URL:`, parsed.DATABASE_URL ? `${parsed.DATABASE_URL.substring(0, 30)}...` : undefined);
    console.log(`APP_DATABASE_URL:`, parsed.APP_DATABASE_URL ? `${parsed.APP_DATABASE_URL.substring(0, 30)}...` : undefined);
  }
}
