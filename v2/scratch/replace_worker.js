const fs = require('fs');
const file = 'src/lib/queue/worker.ts';
let content = fs.readFileSync(file, 'utf8');

// 1. Where resolvedCountryForConv is computed, use only crmData.country or existingConvCountry
// We need to inject deterministicCountry into metadata instead of setting it in the top-level country.
content = content.replace(
  /const resolvedCountryForConv = crmData\?\.country \|\| existingConvCountry;/g,
  `const resolvedCountryForConv = crmData?.country || existingConvCountry || null;`
);

// Actually, wait, let's use the multi_replace_file_content tool, it's safer than string replacing blindly.
