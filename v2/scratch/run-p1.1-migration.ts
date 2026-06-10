import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
  console.log("DATABASE_URL in env:", process.env.DATABASE_URL ? "SET" : "NOT SET");
  console.log("DATABASE_URL preview:", process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^@]+@/, ":****@") : "NONE");
  console.log("Starting Phase P1.1 Migration...");
  
  const { GET, POST } = await import("../src/app/api/migrate/route");
  
  const token = process.env.ADMIN_SETUP_KEY || process.env.CRON_SECRET || "dev";
  
  const mockReq = {
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'authorization') {
          return `Bearer ${token}`;
        }
        return null;
      }
    }
  } as any;

  const resGet = await GET(mockReq);
  console.log("Migration GET Result:", JSON.stringify(await resGet.json(), null, 2));

  console.log("Validating Migration...");
  const resPost = await POST(mockReq);
  console.log("Migration POST Validation Result:", JSON.stringify(await resPost.json(), null, 2));
}

run().catch(console.error);
