import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

process.env.TEST_TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
process.env.TEST_USER_ROLE = "owner";

async function run() {
  const { syncGoogleSheets } = await import("../src/app/actions/forms");
  console.log("Calling syncGoogleSheets...");
  const res = await syncGoogleSheets();
  console.log("Result:", JSON.stringify(res, null, 2));
}

run().catch(console.error);
