import * as path from 'path';
import * as fs from 'fs';
import { parse } from 'dotenv';

const p = path.join(__dirname, '../../.env');
if (fs.existsSync(p)) {
  const content = fs.readFileSync(p, 'utf-8');
  const parsed = parse(content);
  console.log("Root .env keys:", Object.keys(parsed));
  for (const [k, v] of Object.entries(parsed)) {
    console.log(`${k}: ${v ? v.substring(0, 30) : ''}...`);
  }
} else {
  console.log("Root .env not found");
}
