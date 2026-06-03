import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../.env.local") });
console.log("DATABASE_URL:", process.env.DATABASE_URL);
console.log("APP_DATABASE_URL:", process.env.APP_DATABASE_URL);
