import { config } from 'dotenv';
import { Pool } from '@neondatabase/serverless';
config({ path: '.env.local' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT * FROM messages LIMIT 1')
  .then(res => console.log(Object.keys(res.rows[0] || {})))
  .catch(err => console.error("DB ERROR", err.message))
  .finally(() => pool.end());
