import { parseDateSafe, getCanonicalKey } from "../src/lib/services/sheets-ingestion.service";
import crypto from "crypto";

async function runTests() {
  console.log("==================================================");
  console.log("  RUNNING INCREMENTAL SYNC & DATE PARSER TESTS   ");
  console.log("==================================================");

  let passed = true;
  const assert = (cond: boolean, msg: string) => {
    if (cond) {
      console.log(`✅ PASSED: ${msg}`);
    } else {
      console.error(`❌ FAILED: ${msg}`);
      passed = false;
    }
  };

  // 1. ISO tarih parse: 2026-06-11T15:16:42-05:00
  const d1 = parseDateSafe("2026-06-11T15:16:42-05:00");
  assert(d1 !== null && d1.toISOString() === "2026-06-11T20:16:42.000Z", "ISO tarih parsing offset preserving");

  // 2. Türk tarih parse: 31.05.2026 04:09:32
  const d2 = parseDateSafe("31.05.2026 04:09:32");
  assert(d2 !== null && d2.toISOString() === "2026-05-31T01:09:32.000Z", "Türk tarih parsing with Europe/Istanbul timezone");

  // 3. Türk tarih kısa format: 31.05.2026 04:09
  const d3 = parseDateSafe("31.05.2026 04:09");
  assert(d3 !== null && d3.toISOString() === "2026-05-31T01:09:00.000Z", "Türk kısa tarih parsing with Europe/Istanbul timezone");

  // 4. Invalid tarih: invalid-date -> sonuç null
  const d4 = parseDateSafe("invalid-date");
  assert(d4 === null, "Invalid tarih returns null");

  // 5. Aynı telefon + aynı form + farklı Türk tarih: canonical key farklı olmalı
  const k1 = getCanonicalKey("905546833306", "Ortopedi", "31.05.2026 04:09:32");
  const k2 = getCanonicalKey("905546833306", "Ortopedi", "01.06.2026 04:09:32");
  assert(k1 !== k2, "Aynı telefon + aynı form + farklı Türk tarihleri farklı canonical key üretiyor");
  console.log(`   Key 1: ${k1}`);
  console.log(`   Key 2: ${k2}`);

  // 6. Aynı telefon + aynı form + invalid tarih: boş timestamp collision üretmemeli
  // Row 1: notes = "A"
  const rawData1 = { phone: "905546833306", name: "User A", notes: "A", date: "invalid-date" };
  const k3 = getCanonicalKey("905546833306", "Ortopedi", null, rawData1);
  
  // Row 2: notes = "B"
  const rawData2 = { phone: "905546833306", name: "User A", notes: "B", date: "invalid-date" };
  const k4 = getCanonicalKey("905546833306", "Ortopedi", null, rawData2);

  assert(k3 !== k4, "Aynı telefon + aynı form + invalid tarih ama farklı satır alanları collision üretmiyor (fingerprint fallback)");
  console.log(`   Invalid Date Row 1 Key: ${k3}`);
  console.log(`   Invalid Date Row 2 Key: ${k4}`);

  // 7. ingestSheetBatch mock simulation
  console.log("\nSimulating mock partition loop (ingestSheetBatch logic)...");
  
  const existingLeads = [
    {
      id: "lead-existing-1",
      phone_number: "905546833306",
      form_name: "Ortopedi",
      raw_data: JSON.stringify({ phone: "905546833306", name: "User A", notes: "A", date: "invalid-date" })
    }
  ];

  // Map existing leads like the actual code
  const existingLeadsMap = new Map<string, any>();
  for (const lead of existingLeads) {
    // extractSheetDateFromRaw will fail to parse "invalid-date", returning ""
    const dbTime = ""; 
    const key = getCanonicalKey(lead.phone_number, lead.form_name, dbTime, lead.raw_data);
    existingLeadsMap.set(key, lead);
  }

  // Incoming sheet rows
  const mockSheetRows = [
    // Row 1: same phone, same form, same invalid date, same notes (representing unchanged/duplicate)
    { phone: "905546833306", name: "User A", notes: "A", date: "invalid-date", rawData: JSON.stringify({ phone: "905546833306", name: "User A", notes: "A", date: "invalid-date" }) },
    // Row 2: same phone, same form, same invalid date, DIFFERENT notes (representing new/updated row)
    { phone: "905546833306", name: "User A", notes: "B", date: "invalid-date", rawData: JSON.stringify({ phone: "905546833306", name: "User A", notes: "B", date: "invalid-date" }) },
  ];

  let newRowsCount = 0;
  let changedRowsCount = 0;
  let duplicateRowsCount = 0;
  const seenKeys = new Set<string>();

  for (const row of mockSheetRows) {
    const sheetTime = ""; // failed to parse
    const rowKey = getCanonicalKey(row.phone, "Ortopedi", sheetTime, row.rawData);

    if (seenKeys.has(rowKey)) {
      duplicateRowsCount++;
      continue;
    }
    seenKeys.add(rowKey);

    const matchedLead = existingLeadsMap.get(rowKey);
    if (!matchedLead) {
      newRowsCount++;
    } else {
      changedRowsCount++;
    }
  }

  assert(newRowsCount === 1, "Mock ingestion successfully splits collision row into new/different record");
  assert(changedRowsCount === 1, "Mock ingestion correctly maps the matching existing row to update/change flow");
  assert(duplicateRowsCount === 0, "No duplicate rows processed incorrectly due to empty suffix");

  console.log(`   New Rows Partitioned: ${newRowsCount}`);
  console.log(`   Changed Rows Partitioned: ${changedRowsCount}`);
  console.log(`   Duplicate Rows Partitioned: ${duplicateRowsCount}`);

  if (passed) {
    console.log("\n==================================================");
    console.log("  ALL TESTS PASSED SUCCESSFULLY!                 ");
    console.log("==================================================");
  } else {
    console.error("\n==================================================");
    console.error("  SOME TESTS FAILED!                             ");
    console.error("==================================================");
    process.exit(1);
  }
}

runTests().catch(console.error);
