import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { NextRequest } from "next/server";

async function run() {
  // Dynamically import GET/POST so they are evaluated after dotenv.config() runs
  const { GET, POST } = await import("../src/app/api/migrate/route");

  const setupKey = process.env.ADMIN_SETUP_KEY || process.env.CRON_SECRET || 'dev';

  console.log("=== RUNNING MIGRATION ROUTE GET ===");
  const reqGet = new NextRequest("http://localhost/api/migrate", {
    headers: { "authorization": `Bearer ${setupKey}` }
  });
  const resGet = await GET(reqGet);
  console.log("GET Status:", resGet.status);
  console.log("GET Response:", await resGet.json());

  console.log("\n=== RUNNING MIGRATION ROUTE POST (VALIDATION) ===");
  const reqPost = new NextRequest("http://localhost/api/migrate", {
    headers: { "authorization": `Bearer ${setupKey}` }
  });
  const resPost = await POST(reqPost);
  console.log("POST Status:", resPost.status);
  console.log("POST Response:", await resPost.json());
}

run().catch(console.error);
