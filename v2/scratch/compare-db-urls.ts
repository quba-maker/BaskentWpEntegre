import * as path from 'path';
import * as fs from 'fs';
import { parse } from 'dotenv';

const prodPath = path.join(__dirname, '../.env.vercel.prod');
const prodEnv = fs.existsSync(prodPath) ? parse(fs.readFileSync(prodPath, 'utf-8')) : {};

console.log("Prod env keys:", Object.keys(prodEnv));
for (const [k, v] of Object.entries(prodEnv)) {
  if (k.includes('DATABASE') || k.includes('URL')) {
    console.log(`${k}: ${v ? v.substring(0, 30) : ''}...`);
  }
}
