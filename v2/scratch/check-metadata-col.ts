import * as fs from 'fs';
import * as path from 'path';

const filePath = path.resolve(__dirname, '../.env.production.local');
console.log("File exists:", fs.existsSync(filePath));
if (fs.existsSync(filePath)) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.trim() && !line.startsWith('#')) {
      const parts = line.split('=');
      console.log("Key:", parts[0].trim());
    }
  }
}
