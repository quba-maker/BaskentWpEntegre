import { getMessages } from '../src/app/actions/inbox';
import { config } from 'dotenv';
config({ path: '.env.local' });

async function run() {
  try {
    const res = await getMessages('905051234567');
    console.log("SUCCESS:", res);
  } catch (err) {
    console.error("ERROR:", err);
  }
}
run();
