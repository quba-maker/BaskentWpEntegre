import * as path from 'path';
import * as fs from 'fs';

const prodPath = path.join(__dirname, '../.env.vercel.prod');
if (fs.existsSync(prodPath)) {
  const content = fs.readFileSync(prodPath, 'utf-8');
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.includes('DATABASE_URL')) {
      console.log("LINE:", line.substring(0, 50));
    }
  }
} else {
  console.log("File not found");
}
