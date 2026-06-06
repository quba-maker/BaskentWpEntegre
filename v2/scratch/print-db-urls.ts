import * as path from 'path';
import * as fs from 'fs';
import { parse } from 'dotenv';

const p = path.join(__dirname, '../.env.local');
if (fs.existsSync(p)) {
  const content = fs.readFileSync(p, 'utf-8');
  const parsed = parse(content);
  console.log("DATABASE_URL:", parsed.DATABASE_URL);
  console.log("APP_DATABASE_URL:", parsed.APP_DATABASE_URL);
} else {
  console.log("File not found");
}
