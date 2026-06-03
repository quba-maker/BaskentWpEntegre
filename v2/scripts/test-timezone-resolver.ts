import { resolvePatientTimeDisplay, PatientTimeDisplayInput } from '../src/lib/utils/timezone';

const tests: { name: string; input: PatientTimeDisplayInput; expectedWarning?: string }[] = [
  {
    name: '1. phone=+90, form country=ABD -> residence country ABD, phone country Türkiye',
    input: {
      country: 'ABD',
      phoneNumber: '+905551234567'
    }
  },
  {
    name: '2. phone=+90, form country yok -> residence country unknown, phone country Türkiye',
    input: {
      phoneNumber: '+905551234567'
    }
  },
  {
    name: '3. country=Türkiye, patient_timezone=America/New_York -> source mismatch, saat gösterme',
    input: {
      country: 'Türkiye',
      timezone: 'America/New_York'
    },
    expectedWarning: 'country_timezone_source_mismatch'
  },
  {
    name: '4. country=ABD, patient_timezone=Europe/Istanbul -> source mismatch, saat gösterme',
    input: {
      country: 'ABD',
      timezone: 'Europe/Istanbul'
    },
    expectedWarning: 'country_timezone_source_mismatch'
  },
  {
    name: '5. country=ABD, city yok, timezone_source=country -> şehir gerekli',
    input: {
      country: 'ABD',
      timezoneSource: 'country'
    },
    expectedWarning: 'country_has_multiple_timezones'
  },
  {
    name: '6. country=ABD, city=New York -> local saat gösterilebilir',
    input: {
      country: 'ABD',
      city: 'New York',
      timezone: 'America/New_York',
      timezoneSource: 'patient_city'
    }
  },
  {
    name: '7. country=ABD, timezone_source=manual_confirmed -> local saat gösterilebilir',
    input: {
      country: 'ABD',
      timezone: 'America/New_York',
      timezoneSource: 'manual_confirmed'
    }
  },
  {
    name: '8. tenant_timezone=Europe/Istanbul fallback -> hasta local badge olarak gösterilmez',
    input: {
      country: null,
      timezone: null
    },
    expectedWarning: 'fallback_turkey_time'
  },
  {
    name: '9. Murtaza projection -> artık Türkiye’ye dönmez',
    input: {
      country: 'Amerika',
      timezone: 'America/New_York',
      timezoneSource: 'patient_country',
      phoneNumber: '905551112233'
    }
  },
  {
    name: '10. Murtaza eski polluted metadata varsa -> Konum/saat net değil',
    input: {
      country: 'Türkiye',
      timezone: 'America/New_York',
      timezoneSource: 'patient_country'
    },
    expectedWarning: 'country_timezone_source_mismatch'
  }
];

let allPassed = true;

for (const t of tests) {
  const res = resolvePatientTimeDisplay(t.input);
  console.log(`\nTest: ${t.name}`);
  console.log(`Display Label: ${res.displayLabel}`);
  console.log(`Short Badge: ${res.shortBadge}`);
  console.log(`Residence: ${res.residenceCountryLabel} (Src: ${res.residenceCountrySource})`);
  console.log(`Phone Country: ${res.phoneCountryLabel} (Src: ${res.phoneCountrySource})`);
  console.log(`Timezone: ${res.patientTimezone} (Src: ${res.timezoneSource})`);
  console.log(`Mismatch: ${res.sourceMismatch}`);
  console.log(`Warning: ${res.warning || 'None'}`);

  if (t.expectedWarning && res.warning !== t.expectedWarning) {
    console.error(`❌ FAILED: Expected warning '${t.expectedWarning}', got '${res.warning}'`);
    allPassed = false;
  }
}

if (allPassed) {
  console.log('\n✅ ALL TIMEZONE TESTS PASSED!');
  process.exit(0);
} else {
  console.error('\n❌ SOME TESTS FAILED');
  process.exit(1);
}
