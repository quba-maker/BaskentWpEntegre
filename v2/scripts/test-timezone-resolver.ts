import { resolvePatientTimeDisplay } from "../src/lib/utils/timezone";

function runTests() {
  console.log("=== RUNNING UNIVERSAL TIMEZONE DISPLAY RESOLVER TEST SUITE ===\n");
  const refDate = new Date("2026-06-03T12:00:00Z"); // 12:00 UTC / 15:00 TRT

  // Scenario 1: Almanya -> Europe/Berlin, doğru saat/GMT offset
  console.log("Scenario 1: Almanya (Germany) -> Europe/Berlin");
  const s1 = resolvePatientTimeDisplay({
    country: "Almanya",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s1, null, 2));
  if (s1.patientTimezone !== "Europe/Berlin") throw new Error("Scenario 1 failed: Expected Europe/Berlin");
  if (s1.needsTimezoneClarification) throw new Error("Scenario 1 failed: Expected needsTimezoneClarification to be false");
  console.log("✅ Passed.\n");

  // Scenario 2: Türkiye -> Europe/Istanbul
  console.log("Scenario 2: Türkiye -> Europe/Istanbul");
  const s2 = resolvePatientTimeDisplay({
    country: "Türkiye",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s2, null, 2));
  if (s2.patientTimezone !== "Europe/Istanbul") throw new Error("Scenario 2 failed: Expected Europe/Istanbul");
  if (s2.offsetLabel !== "GMT+3") throw new Error("Scenario 2 failed: Expected GMT+3");
  console.log("✅ Passed.\n");

  // Scenario 3: ABD + şehir yok -> needsTimezoneClarification=true, local saat yok
  console.log("Scenario 3: ABD + şehir yok");
  const s3 = resolvePatientTimeDisplay({
    country: "ABD",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s3, null, 2));
  if (!s3.needsTimezoneClarification) throw new Error("Scenario 3 failed: Expected needsTimezoneClarification to be true");
  if (s3.patientLocalTime !== null) throw new Error("Scenario 3 failed: Expected patientLocalTime to be null");
  if (s3.offsetLabel !== null) throw new Error("Scenario 3 failed: Expected offsetLabel to be null");
  console.log("✅ Passed.\n");

  // Scenario 4: ABD + New York -> America/New_York
  console.log("Scenario 4: ABD + New York -> America/New_York");
  const s4 = resolvePatientTimeDisplay({
    country: "ABD",
    city: "New York",
    timezone: "America/New_York",
    timezoneSource: "patient_city",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s4, null, 2));
  if (s4.patientTimezone !== "America/New_York") throw new Error("Scenario 4 failed: Expected America/New_York");
  if (s4.needsTimezoneClarification) throw new Error("Scenario 4 failed: Expected needsTimezoneClarification to be false");
  console.log("✅ Passed.\n");

  // Scenario 5: ABD + Los Angeles -> America/Los_Angeles
  console.log("Scenario 5: ABD + Los Angeles -> America/Los_Angeles");
  const s5 = resolvePatientTimeDisplay({
    country: "ABD",
    city: "Los Angeles",
    timezone: "America/Los_Angeles",
    timezoneSource: "patient_city",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s5, null, 2));
  if (s5.patientTimezone !== "America/Los_Angeles") throw new Error("Scenario 5 failed: Expected America/Los_Angeles");
  if (s5.needsTimezoneClarification) throw new Error("Scenario 5 failed: Expected needsTimezoneClarification to be false");
  console.log("✅ Passed.\n");

  // Scenario 6: Kanada + şehir yok -> clarification
  console.log("Scenario 6: Kanada + şehir yok");
  const s6 = resolvePatientTimeDisplay({
    country: "Kanada",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s6, null, 2));
  if (!s6.needsTimezoneClarification) throw new Error("Scenario 6 failed: Expected needsTimezoneClarification to be true");
  console.log("✅ Passed.\n");

  // Scenario 7: Rusya + şehir yok -> clarification
  console.log("Scenario 7: Rusya + şehir yok");
  const s7 = resolvePatientTimeDisplay({
    country: "Rusya",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s7, null, 2));
  if (!s7.needsTimezoneClarification) throw new Error("Scenario 7 failed: Expected needsTimezoneClarification to be true");
  console.log("✅ Passed.\n");

  // Scenario 8: metadata.patient_timezone varsa ülke mapping'i ezilir
  console.log("Scenario 8: metadata.patient_timezone ve ülke uyumsuzluğu");
  const s8 = resolvePatientTimeDisplay({
    country: "Türkiye",
    timezone: "Europe/London",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s8, null, 2));
  if (s8.patientTimezone !== "Europe/London") throw new Error("Scenario 8 failed: Expected Europe/London");
  console.log("✅ Passed.\n");

  // Scenario 9: Fallback Europe/Istanbul hasta local badge olarak gösterilmez
  console.log("Scenario 9: Fallback (Bilinmeyen Ülke)");
  const s9 = resolvePatientTimeDisplay({
    country: "Bilinmeyen",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s9, null, 2));
  if (s9.patientLocalTime !== null) throw new Error("Scenario 9 failed: Expected patientLocalTime to be null in fallback");
  if (s9.shortBadge !== "Saat net değil") throw new Error("Scenario 9 failed: Expected badge 'Saat net değil'");
  console.log("✅ Passed.\n");

  console.log("🎉 ALL TIMEZONE RESOLVER SCENARIOS PASSED SUCCESSFULLY! 🎉");
}

runTests();
