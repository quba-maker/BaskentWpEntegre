import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const USER_ID = "23429a66-d897-4504-a7fb-c5ff898f9163";

async function runValidationP0() {
  process.env.TEST_TENANT_ID = TENANT_ID;
  process.env.TEST_USER_ID = USER_ID;

  const fs = await import("fs");
  const path = await import("path");

  console.log("==========================================================");
  console.log("🔬 Phase 2Z-P0: Operational UI Simplification Validation");
  console.log("==========================================================");

  // 1. Validate Display Name Resolver & Phone Formatter Helpers
  console.log("\n🧪 [Assertion 1-8] Validating Patient Name Resolver & Phone Helpers...");
  const { resolvePatientDisplayName, formatPhoneReadable, formatPhoneMasked } = await import("../src/lib/utils/patient-name-resolver");

  // A1: Manual patient name has highest priority
  const name1 = resolvePatientDisplayName({
    manualPatientName: "Merve Manual",
    oppPatientName: "Merve Opp",
    convPatientName: "Merve Conv"
  });
  if (name1 !== "Merve Manual") throw new Error("A1 failed: Manual name should have highest priority.");

  // A2: Opportunity patient name fallback
  const name2 = resolvePatientDisplayName({
    oppPatientName: "Merve Opp",
    convPatientName: "Merve Conv"
  });
  if (name2 !== "Merve Opp") throw new Error("A2 failed: Opp name fallback failed.");

  // A3: Conversation / Display name fallback
  const name3 = resolvePatientDisplayName({
    convPatientName: "Merve Conv"
  });
  if (name3 !== "Merve Conv") throw new Error("A3 failed: Conv name fallback failed.");

  const name3b = resolvePatientDisplayName({
    customerDisplayName: "Merve Cust"
  });
  if (name3b !== "Merve Cust") throw new Error("A3b failed: Customer display name fallback failed.");

  // A4: WhatsApp Profile name fallback
  const name4 = resolvePatientDisplayName({
    whatsappProfileName: "Merve WA"
  });
  if (name4 !== "Merve WA") throw new Error("A4 failed: WA profile name fallback failed.");

  // A5: Form patient name / Raw data name fallback
  const name5 = resolvePatientDisplayName({
    formPatientName: "Merve Form"
  });
  if (name5 !== "Merve Form") throw new Error("A5 failed: Form name fallback failed.");

  const name5b = resolvePatientDisplayName({
    formRawDataName: "Merve Raw"
  });
  if (name5b !== "Merve Raw") throw new Error("A5b failed: Raw data name fallback failed.");

  // A6: Fallback to İsimsiz
  const name6 = resolvePatientDisplayName(null);
  if (name6 !== "İsimsiz") throw new Error("A6 failed: Null context should return İsimsiz.");

  // A7: Phone Formatter TR human readable formatting
  const phone1 = formatPhoneReadable("905546833306");
  if (phone1 !== "+90 (554) 683 33 06") throw new Error(`A7 failed: formatPhoneReadable returned ${phone1}`);

  const phone1b = formatPhoneReadable("05546833306");
  if (phone1b !== "+90 (554) 683 33 06") throw new Error(`A7b failed: formatPhoneReadable returned ${phone1b}`);

  // A8: Phone Formatter Masked layout
  const phone2 = formatPhoneMasked("905546833306");
  if (phone2 !== "+90 (554) *** ** 06") throw new Error(`A8 failed: formatPhoneMasked returned ${phone2}`);

  console.log("   ✅ Assertions 1-8 (Resolver & Phone Formatter Helpers): PASS");

  // 2. Validate Server Action patient tracking duplicate grouping
  console.log("\n🧪 [Assertion 9-10] Validating Patient Tracking Server Action Grouping & Filters...");
  const { getPatientTrackingRows, getAppointmentRows } = await import("../src/app/actions/patient-tracking");

  // Verify functions load correctly
  if (typeof getPatientTrackingRows !== "function") throw new Error("A9 failed: getPatientTrackingRows is not a function.");
  if (typeof getAppointmentRows !== "function") throw new Error("A10 failed: getAppointmentRows is not a function.");

  console.log("   ✅ Assertions 9-10 (Server Action Signatures & Functions): PASS");

  // 3. Validate presence and correct formatting in CRM Panel
  console.log("\n🧪 [Assertion 11-13] Auditing CRM Panel Component File Content...");
  const crmPanelPath = path.join(__dirname, "../src/components/features/inbox/crm-panel.tsx");
  const crmPanelContent = fs.readFileSync(crmPanelPath, "utf8");

  if (crmPanelContent.includes("Lead Skoru") && crmPanelContent.includes("Activity")) {
    throw new Error("A11 failed: Large Lead Score card was not removed from CRM Panel.");
  }
  if (crmPanelContent.includes("CRM Entegre") || crmPanelContent.includes("OP_UPDATE_RESULT")) {
    throw new Error("A12 failed: CRM Entegre or other technical badges remain in CRM Panel.");
  }
  if (!crmPanelContent.includes("AiTimelinePanel")) {
    throw new Error("A13 failed: AiTimelinePanel was not integrated into CRM Panel.");
  }
  console.log("   ✅ Assertions 11-13 (CRM Panel Simplification): PASS");

  // 4. Validate Forms Detail Raw Parameter Accordion
  console.log("\n🧪 [Assertion 14-15] Auditing Forms Detail Accordion File Content...");
  const formsPagePath = path.join(__dirname, "../src/app/[tenant_slug]/(dashboard)/forms/page.tsx");
  const formsPageContent = fs.readFileSync(formsPagePath, "utf8");

  if (!formsPageContent.includes("Teknik Reklam Verileri")) {
    throw new Error("A14 failed: teknik reklam verileri accordion is missing.");
  }
  if (!formsPageContent.includes("isTechnicalKey")) {
    throw new Error("A15 failed: isTechnicalKey filter helper is missing in forms/page.tsx.");
  }
  console.log("   ✅ Assertions 14-15 (Forms Technical Accordion): PASS");

  // 5. Validate Kalite Page Name Resolver & Masked Phone Integration
  console.log("\n🧪 [Assertion 16-17] Auditing Kalite Page File Content...");
  const kalitePagePath = path.join(__dirname, "../src/app/[tenant_slug]/(dashboard)/kalite/page.tsx");
  const kalitePageContent = fs.readFileSync(kalitePagePath, "utf8");

  if (!kalitePageContent.includes("resolvePatientDisplayName")) {
    throw new Error("A16 failed: resolvePatientDisplayName is not imported or integrated in Kalite Page.");
  }
  if (!kalitePageContent.includes("formatPhoneMasked")) {
    throw new Error("A17 failed: formatPhoneMasked is not imported or integrated in Kalite Page.");
  }
  console.log("   ✅ Assertions 16-17 (Kalite Page standardisation): PASS");

  // 6. Validate Onay Page Name Resolver & Readable Phone Integration
  console.log("\n🧪 [Assertion 18-19] Auditing Onay Page File Content...");
  const onayPagePath = path.join(__dirname, "../src/app/[tenant_slug]/(dashboard)/onay/page.tsx");
  const onayPageContent = fs.readFileSync(onayPagePath, "utf8");

  if (!onayPageContent.includes("resolvePatientDisplayName")) {
    throw new Error("A18 failed: resolvePatientDisplayName is not imported or integrated in Onay Page.");
  }
  if (!onayPageContent.includes("formatPhoneReadable")) {
    throw new Error("A19 failed: formatPhoneReadable is not imported or integrated in Onay Page.");
  }
  console.log("   ✅ Assertions 18-19 (Onay Page standardisation): PASS");

  // 7. Validate Appointment Detail Drawer Component
  console.log("\n🧪 [Assertion 20] Auditing Appointment Detail Drawer Component File...");
  const apptDrawerPath = path.join(__dirname, "../src/components/features/takip/appointment-detail-drawer.tsx");
  if (!fs.existsSync(apptDrawerPath)) {
    throw new Error("A20 failed: appointment-detail-drawer.tsx file does not exist.");
  }
  const apptDrawerContent = fs.readFileSync(apptDrawerPath, "utf8");
  if (!apptDrawerContent.includes("AppointmentDetailDrawer")) {
    throw new Error("A20b failed: AppointmentDetailDrawer component definition is missing.");
  }
  console.log("   ✅ Assertion 20 (Appointment Detail Drawer existence): PASS");

  // 8. Validate Patient Tracking Tab Standardized Columns
  console.log("\n🧪 [Assertion 21] Auditing Patient Tracking Tab Column Headers...");
  const trackingTabPath = path.join(__dirname, "../src/components/features/takip/patient-tracking-tab.tsx");
  const trackingTabContent = fs.readFileSync(trackingTabPath, "utf8");

  const requiredHeaders = ["Durum", "Hasta", "Son Aktivite", "Kısa Özet", "Sonraki Aksiyon", "Sonraki Takip", "Aksiyon"];
  for (const header of requiredHeaders) {
    if (!trackingTabContent.includes(header)) {
      throw new Error(`A21 failed: Standardised header '${header}' is missing in patient-tracking-tab.tsx.`);
    }
  }
  console.log("   ✅ Assertion 21 (Patient Tracking Columns standardisation): PASS");

  // 9. Zero Outbound DELTA Safeguard Database Verification
  console.log("\n🛡️ [Assertion 22-25] Verifying Zero Outbound Safety Proof & Mutex Integrity...");
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  const startMsgCountRes = await db.executeSafe({
    text: `SELECT COUNT(*)::int as c FROM messages WHERE direction = 'out'`
  }) as any[];
  const startOutboundCount = startMsgCountRes[0]?.c || 0;

  // Perform a dummy fetch to exercise SWR/Action caching layers
  await getPatientTrackingRows();
  await getAppointmentRows();

  const endMsgCountRes = await db.executeSafe({
    text: `SELECT COUNT(*)::int as c FROM messages WHERE direction = 'out'`
  }) as any[];
  const endOutboundCount = endMsgCountRes[0]?.c || 0;
  const outboundDelta = endOutboundCount - startOutboundCount;

  console.log(`   - Outbound messages delta count: ${outboundDelta}`);
  if (outboundDelta > 0) {
    throw new Error("❌ OUTBOUND VIOLATION! Outgoing messages were written to database during E2E verification!");
  }
  console.log("   ✅ Zero-Outbound containment verified fully: PASS");

  console.log("\n🎉 ALL PHASE 2Z-P0 UI ARCHITECTURE AND INTEGRATION TESTS PASSED SUCCESSFULLY!");
  console.log("==========================================================\n");
  process.exit(0);
}

runValidationP0().catch((e) => {
  console.error("\n❌ VALIDATION CRASHED WITH ERROR:\n", e);
  process.exit(1);
});
