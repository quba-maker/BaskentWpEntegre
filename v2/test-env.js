import dotenv from "dotenv";
dotenv.config({ path: ".env" });
console.log(process.env.DATABASE_URL ? "URL loaded" : "URL not loaded");
