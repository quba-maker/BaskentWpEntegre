import { withTenantDB } from '../src/lib/core/tenant-db';
import { resolvePatientTimeDisplay } from '../src/lib/utils/timezone';

const db = withTenantDB('00000000-0000-0000-0000-000000000000', true);

async function auditDB() {
  console.log("=== DRY-RUN POLLUTION AUDIT ===");

  const stats = {
    recordsScanned: 0,
    sourceMismatch: 0,
    phoneCountryVsResidenceCountryRisk: 0,
    countryTurkeyTimezoneAmerica: 0,
    countryUSATimezoneIstanbul: 0,
    murtazaLikePolluted: 0,
  };

  try {
    const records = await db.executeSafe({
      text: `SELECT c.phone_number, COALESCE(c.country, o.country) as country, o.metadata->>'patient_timezone' as timezone, o.metadata->>'patient_city' as city 
             FROM conversations c 
             LEFT JOIN opportunities o ON c.id = o.conversation_id 
             WHERE c.country IS NOT NULL OR o.country IS NOT NULL OR o.metadata->>'patient_timezone' IS NOT NULL`
    }) as any[];
    
    stats.recordsScanned = records.length;

    for (const row of records) {
      const { phone_number, country, timezone, city } = row;

      const res = resolvePatientTimeDisplay({
        phoneNumber: phone_number,
        country: country,
        city: city,
        timezone: timezone
      });

      if (res.sourceMismatch) {
        stats.sourceMismatch++;
      }

      if (res.phoneCountryLabel && res.residenceCountryLabel !== 'Bilinmeyen Ülke' && res.phoneCountryLabel !== res.residenceCountryLabel) {
        stats.phoneCountryVsResidenceCountryRisk++;
      }

      if (res.residenceCountryLabel === 'Türkiye' && timezone?.startsWith('America/')) {
        stats.countryTurkeyTimezoneAmerica++;
        stats.murtazaLikePolluted++; 
      }

      if (res.residenceCountryLabel === 'ABD' && timezone === 'Europe/Istanbul') {
        stats.countryUSATimezoneIstanbul++;
        stats.murtazaLikePolluted++; 
      }
    }

    console.log(JSON.stringify(stats, null, 2));
    console.log("✅ CANLI DB UPDATE YAPILMADI. YALNIZCA READ-ONLY SORGULAMALAR YAPILDI.");

  } catch (error) {
    console.error("Audit failed", error);
  }
}

auditDB();
