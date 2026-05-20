import { GET } from "./src/app/api/admin/recover-integrations/route";
import { NextRequest } from "next/server";

async function run() {
  const req = new NextRequest("http://localhost/api/admin/recover-integrations", {
    headers: { "authorization": "Bearer dev" }
  });
  const res = await GET(req);
  console.log(await res.json());
}
run();
