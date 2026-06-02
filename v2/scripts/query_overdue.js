const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "../.env.local");
if (!fs.existsSync(envPath)) {
  console.error("Error: .env.local not found at " + envPath);
  process.exit(1);
}

const envText = fs.readFileSync(envPath, "utf8");
const match = envText.match(/DATABASE_URL=["']?([^"'\r\n]+)/);
const dbUrl = match ? match[1] : null;

if (!dbUrl) {
  console.error("Error: DATABASE_URL not found in .env.local!");
  process.exit(1);
}

const cleanDbUrl = dbUrl.replace(/['"]/g, "").trim();

async function main() {
  const { neon } = require("@neondatabase/serverless");
  const sql = neon(cleanDbUrl);
  
  console.log("Checking active overdue tasks in follow_up_tasks...");
  const tasks = await sql`
    SELECT 
      t.id, 
      t.status, 
      t.due_at, 
      t.task_type, 
      t.metadata, 
      t.opportunity_id,
      o.patient_name as opp_patient,
      o.stage as opp_stage,
      o.tenant_id as opp_tenant
    FROM follow_up_tasks t
    LEFT JOIN opportunities o ON o.id = t.opportunity_id
    WHERE t.status IN ('pending', 'in_progress')
      AND t.due_at < NOW()
    ORDER BY t.due_at DESC
    LIMIT 20
  `;
  console.log("\n--- OVERDUE TASKS ---");
  console.log(JSON.stringify(tasks, null, 2));
}
main().catch(console.error);
