import dotenv from "dotenv";
import path from "path";
import { syncGoogleSheets } from "../src/app/actions/forms";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

async function run() {
  console.log("Running actual syncGoogleSheets action...");
  const res = await syncGoogleSheets();
  console.log("Sync Action Response:", JSON.stringify(res, null, 2));
}

run().catch(console.error);
