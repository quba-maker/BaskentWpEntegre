import 'dotenv/config';
import { db } from '../src/lib/db/index';

async function run() {
  const opps = await db.executeSafe({
    text: `SELECT id, patient_name, phone_number, country, metadata, lead_raw_data FROM opportunities WHERE patient_name = 'Murtaza'`,
    values: []
  });
  console.log("OPPORTUNITY:", JSON.stringify(opps, null, 2));

  const convs = await db.executeSafe({
    text: `SELECT id, phone_number, country, metadata FROM conversations WHERE phone_number = $1`,
    values: [opps[0]?.phone_number]
  });
  console.log("CONVERSATION:", JSON.stringify(convs, null, 2));
  
  process.exit(0);
}

run();
