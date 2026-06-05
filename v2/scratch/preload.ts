import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

if (process.env.APP_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.APP_DATABASE_URL;
}
