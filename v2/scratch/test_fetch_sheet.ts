import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const apiKey = "AIzaSyAxNUHQCrXzmATX4YuMgcFP3u4EW_jsJYc";
const spreadsheetId = "1oSKJ-iYiZPltYUQ73_O-FaFdelhwAwtf09wVKKVs1GQ";

async function run() {
  const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const metaResp = await fetch(`${BASE_URL}?key=${apiKey}&fields=sheets.properties`);
  if (!metaResp.ok) {
    console.error("Meta response error:", await metaResp.text());
    return;
  }
  const metaData = await metaResp.json();
  const allTabs = metaData.sheets
    .filter((s: any) => !s.properties.hidden)
    .map((s: any) => s.properties.title);
  
  console.log("All visible tabs:", allTabs);

  // Fetch first 10 rows from "Form Yanıtları 1"
  const tabName = "Form Yanıtları 1";
  const rangeParams = `ranges=${encodeURIComponent(tabName)}`;
  const batchUrl = `${BASE_URL}/values:batchGet?key=${apiKey}&${rangeParams}&valueRenderOption=FORMATTED_VALUE`;
  const batchResp = await fetch(batchUrl);
  if (!batchResp.ok) {
    console.error("Batch response error:", await batchResp.text());
    return;
  }
  const batchData = await batchResp.json();
  const values = batchData.valueRanges[0].values || [];
  console.log(`Total rows in '${tabName}':`, values.length);
  if (values.length > 0) {
    console.log("Headers:", values[0]);
    console.log("First row after headers:", values[1]);
    console.log("Last row:", values[values.length - 1]);
  }
}

run();
