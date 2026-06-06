import * as path from 'path';
import * as fs from 'fs';
import { parse } from 'dotenv';

const p = path.join(__dirname, '../.env.local');
if (fs.existsSync(p)) {
  const content = fs.readFileSync(p, 'utf-8');
  const parsed = parse(content);
  for (const [k, v] of Object.entries(parsed)) {
    if (v.includes('api.com')) {
      console.log(`FOUND in .env.local: ${k} = ${v}`);
    }
  }
}

for (const [k, v] of Object.entries(process.env)) {
  if (v && v.includes('api.com')) {
    console.log(`FOUND in process.env: ${k} = ${v}`);
  }
}
