import fs from "fs";
import path from "path";

// Load .env.local manually
const envPath = "/Users/mustafa/Desktop/baskent-wp-entegre/v2/.env.local";
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) return;
    const key = trimmed.substring(0, eqIndex).trim();
    const value = trimmed.substring(eqIndex + 1).replace(/^['"]|['"]$/g, "").trim();
    process.env[key] = value;
  });
}

// Mock session via process.env.TEST_TENANT_ID
process.env.TEST_TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
process.env.TEST_USER_ID = "23429a66-d897-4504-a7fb-c5ff898f9163"; // Baskent Admin

async function run() {
  const { getAppointmentRows } = await import("/Users/mustafa/Desktop/baskent-wp-entegre/v2/src/app/actions/patient-tracking");
  
  const result = await getAppointmentRows({
    search: undefined,
    dueRange: undefined,
    appointmentType: undefined,
    completed: false,
    confirmationStatus: undefined
  });
  
  console.log("getAppointmentRows output:");
  console.log(JSON.stringify(result, null, 2));
}

run().catch(console.error);
