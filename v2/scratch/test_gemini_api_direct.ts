import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set');
    process.exit(1);
  }

  console.log('Testing Gemini API key:', apiKey.substring(0, 8) + '...');

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Merhaba, nasılsın?' }]
      }
    ]
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log('Response Status:', response.status);
    console.log('Response OK:', response.ok);

    const text = await response.text();
    console.log('Response Text:');
    try {
      const parsed = JSON.parse(text);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(text);
    }
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

run().catch(console.error);
