import * as path from 'path';
import * as fs from 'fs';
import { config } from 'dotenv';

const paths = [
  path.join(__dirname, '../.env.production.local'),
  path.join(__dirname, '../.env.local'),
  path.join(__dirname, '../.env'),
  path.join(__dirname, '../../.env.local'),
];

for (const p of paths) {
  if (fs.existsSync(p)) {
    console.log("Loading env from:", p);
    config({ path: p });
  }
}

console.log("Available DB-related env keys:");
const dbKeys = Object.keys(process.env).filter(k => k.includes('DB') || k.includes('DATA') || k.includes('URL') || k.includes('NEON'));
console.log(dbKeys);
for (const k of dbKeys) {
  console.log(`${k}: ${process.env[k]?.substring(0, 15)}...`);
}
