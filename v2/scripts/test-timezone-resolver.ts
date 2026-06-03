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

  // Scenario 8: metadata.patient_timezone varsa ülke mapping'i ezilir (Almanya vb. tek timezone için)
  console.log("Scenario 8: metadata.patient_timezone ve ülke uyumsuzluğu (Tek Timezone)");
  const s8 = resolvePatientTimeDisplay({
    country: "Almanya",
    timezone: "Europe/London",
    timezoneSource: "manual_confirmed",
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

  // === NEW CRITICAL SECURITY TRUST RULE SCENARIOS ===

  // 10. ABD + patient_timezone=America/New_York + timezone_source=country + şehir yok
  console.log("Scenario 10: ABD + patient_timezone + timezone_source=country (Güvensiz)");
  const s10 = resolvePatientTimeDisplay({
    country: "Amerika",
    timezone: "America/New_York",
    timezoneSource: "country",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s10, null, 2));
  if (!s10.needsTimezoneClarification) throw new Error("Scenario 10 failed: Expected needsTimezoneClarification = true");
  if (s10.patientTimezone !== null) throw new Error("Scenario 10 failed: Expected patientTimezone = null");
  if (s10.patientLocalTime !== null) throw new Error("Scenario 10 failed: Expected patientLocalTime = null");
  console.log("✅ Passed.\n");

  // 11. ABD + patient_timezone=America/New_York + timezone_source=manual_confirmed
  console.log("Scenario 11: ABD + patient_timezone + timezone_source=manual_confirmed (Güvenli)");
  const s11 = resolvePatientTimeDisplay({
    country: "Amerika",
    timezone: "America/New_York",
    timezoneSource: "manual_confirmed",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s11, null, 2));
  if (s11.needsTimezoneClarification) throw new Error("Scenario 11 failed: Expected needsTimezoneClarification = false");
  if (s11.patientTimezone !== "America/New_York") throw new Error("Scenario 11 failed: Expected America/New_York");
  console.log("✅ Passed.\n");

  // 12. ABD + patient_city=New York
  console.log("Scenario 12: ABD + patient_city=New York (Güvenli)");
  const s12 = resolvePatientTimeDisplay({
    country: "Amerika",
    city: "New York",
    timezone: "America/New_York",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s12, null, 2));
  if (s12.needsTimezoneClarification) throw new Error("Scenario 12 failed: Expected needsTimezoneClarification = false");
  if (s12.patientTimezone !== "America/New_York") throw new Error("Scenario 12 failed: Expected America/New_York");
  console.log("✅ Passed.\n");

  // 13. ABD + eski metadata fallback (timezone_source boş veya inferred_country vb.)
  console.log("Scenario 13: ABD + eski metadata fallback (Güvensiz)");
  const s13 = resolvePatientTimeDisplay({
    country: "Amerika",
    timezone: "America/New_York",
    timezoneSource: "inferred_country",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s13, null, 2));
  if (!s13.needsTimezoneClarification) throw new Error("Scenario 13 failed: Expected needsTimezoneClarification = true");
  if (s13.patientLocalTime !== null) throw new Error("Scenario 13 failed: Expected patientLocalTime = null");
  console.log("✅ Passed.\n");

  // 14. Murtaza canlı projection (şehir/eyalet yoksa, timezone_source = country ise)
  console.log("Scenario 14: Murtaza canlı projection (Teyitsiz ABD)");
  const s14 = resolvePatientTimeDisplay({
    country: "Amerika",
    timezone: "America/New_York",
    timezoneSource: "country",
    referenceDate: refDate
  });
  console.log(JSON.stringify(s14, null, 2));
  if (s14.shortBadge !== "Şehir gerekli") throw new Error("Scenario 14 failed: Expected shortBadge = 'Şehir gerekli'");
  if (s14.displayLabel !== "🌎 ABD • Saat dilimi net değil") throw new Error("Scenario 14 failed: Expected displayLabel = '🌎 ABD • Saat dilimi net değil'");
  console.log("✅ Passed.\n");

  console.log("🎉 ALL 14 TIMEZONE RESOLVER SCENARIOS PASSED SUCCESSFULLY! 🎉");
}

runTests();
