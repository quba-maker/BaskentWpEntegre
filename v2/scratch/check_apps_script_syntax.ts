import fs from "fs";
import path from "path";
import { execSync } from "child_process";

function checkSyntax() {
  const wizardPath = path.resolve(process.cwd(), "src/components/features/integrations/GoogleSheetsWizard.tsx");
  if (!fs.existsSync(wizardPath)) {
    console.error("Wizard file not found at:", wizardPath);
    process.exit(1);
  }

  const content = fs.readFileSync(wizardPath, "utf8");
  
  // Extract the template literal starting with "const code = `" and ending with "`;"
  const startMarker = "const code = `";
  const startIndex = content.indexOf(startMarker);
  if (startIndex === -1) {
    console.error("Could not find start of code template");
    process.exit(1);
  }

  const codeStart = startIndex + startMarker.length;
  // Find the closing backtick of the template literal (excluding escaped ones)
  let endIndex = -1;
  let isEscaped = false;
  for (let i = codeStart; i < content.length; i++) {
    if (content[i] === "\\" && !isEscaped) {
      isEscaped = true;
      continue;
    }
    if (content[i] === "`" && !isEscaped) {
      endIndex = i;
      break;
    }
    isEscaped = false;
  }

  if (endIndex === -1) {
    console.error("Could not find end of code template");
    process.exit(1);
  }

  let rawCode = content.substring(codeStart, endIndex);
  
  // Replace the template variables with dummy strings
  rawCode = rawCode
    .replace(/\${cleanWebhookUrl}/g, "https://quba.baskent.com/api/sheets-webhook")
    .replace(/\${tenantSlug}/g, "baskent")
    .replace(/\${secret \|\| 'PASTE_SECRET_HERE'}/g, "wh_sec_testsecret123456")
    .replace(/\${sheetName}/g, "Form Yanıtları 1");

  const scratchDir = path.resolve(process.cwd(), "scratch");
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir);
  }

  const outputPath = path.join(scratchDir, "generated-quba-apps-script.js");
  fs.writeFileSync(outputPath, rawCode, "utf8");
  console.log("Extracted Apps Script code written to:", outputPath);

  // Add line numbers to console log for debugging
  const lines = rawCode.split("\n");
  console.log("\n--- Generated Code with Line Numbers ---");
  lines.forEach((line, idx) => {
    console.log(`${idx + 1}: ${line}`);
  });
  console.log("----------------------------------------\n");

  try {
    execSync(`node --check "${outputPath}"`, { stdio: "inherit" });
    console.log("✅ Syntax check passed!");
  } catch (err: any) {
    console.error("❌ Syntax check failed!");
    process.exit(1);
  }
}

checkSyntax();
