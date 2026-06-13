import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set');
    process.exit(1);
  }

  // Exact payload structure constructed from the conversation history
  const contents = [
    { role: 'model', parts: [{ text: 'Yapay zeka servis dışı kaldığı için görüşme müşteri temsilcisine devredildi. (AI Unavailable: circuit_open)' }] },
    { role: 'user', parts: [{ text: 'merhabalar' }] },
    { role: 'model', parts: [{ text: 'Yapay zeka servis dışı kaldığı için görüşme müşteri temsilcisine devredildi. (AI Unavailable: billing_exhausted)' }] },
    { role: 'user', parts: [{ text: 'merhabalar' }] },
    { role: 'user', parts: [{ text: 'merhabalar' }] }
  ];

  const payload = {
    systemInstruction: { parts: [{ text: 'Sen Başkent Hastanesi asistanısın. Kısa cevaplar ver.' }] },
    contents
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
    const parsed = JSON.parse(text);
    console.log(JSON.stringify(parsed, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

run().catch(console.error);
