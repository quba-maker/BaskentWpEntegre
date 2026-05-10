import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const META = process.env.META_ACCESS_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

async function getTemplates() {
  try {
    // Doğru endpoint: Phone Number üzerinden WABA ID'yi fields ile çekmek
    const res = await axios.get(`https://graph.facebook.com/v25.0/${PHONE_ID}?fields=whatsapp_business_account`, {
      headers: { Authorization: `Bearer ${META}` }
    });
    
    const wabaId = res.data?.whatsapp_business_account?.id;
    if (!wabaId) {
      console.log('WABA_ID bulunamadı. JSON:', res.data);
      return;
    }

    const r = await axios.get(`https://graph.facebook.com/v25.0/${wabaId}/message_templates?limit=50`, {
      headers: { Authorization: `Bearer ${META}` }
    });
    
    const approved = r.data.data.filter(t => t.status === 'APPROVED');
    console.log('\n✅ ONAYLI ŞABLONLARINIZ:');
    approved.forEach(t => {
      console.log(`- İsim: ${t.name} | Dil: ${t.language}`);
    });
  } catch(e) {
    console.error('Hata:', e.response?.data || e.message);
  }
}
getTemplates();
