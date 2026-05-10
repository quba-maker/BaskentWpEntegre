const https = require('https');
https.get('https://baskent-wp-entegre.vercel.app/api/panel?action=whatsapp-templates', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(data));
}).on('error', err => console.log('Error:', err.message));
