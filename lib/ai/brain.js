import axios from 'axios';
import { getSetting, getConversationState, updateConversationState } from '../db/index.js';
import { getDefaultPrompt } from './prompts.js';
import { determineNextPhase, getPhaseInstruction, PHASES } from './conversationPhaseManager.js';
import { checkHandoverTriggers, executeHandover } from './handoverManager.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Unicode script bazlı dil tespiti
function detectLanguageFromText(text) {
  if (!text) return null;
  const t = text.trim();
  
  // Arapça karakterler (Arabic script)
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t)) return 'Arabic';
  // Rusça/Kiril (Cyrillic)
  if (/[\u0400-\u04FF\u0500-\u052F]/.test(t)) return 'Russian';
  // Çince (CJK)
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(t)) return 'Chinese';
  // Korece (Hangul)
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(t)) return 'Korean';
  // Japonca (Hiragana/Katakana)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(t)) return 'Japanese';
  // Tay dili
  if (/[\u0E00-\u0E7F]/.test(t)) return 'Thai';
  // Farsça (Arabic script + specific chars)
  if (/[\u0600-\u06FF]/.test(t) && /[پچژگ]/.test(t)) return 'Farsi';
  
  // Latin alfabe - yaygın selamlaşmalardan tespit
  const lower = t.toLowerCase();
  if (/^(hello|hi|hey|good morning|good evening|i need|i want|can you|please|thank)/.test(lower)) return 'English';
  if (/^(bonjour|salut|bonsoir|je veux|j'ai besoin|merci)/.test(lower)) return 'French';
  if (/^(hallo|guten|ich brauche|ich möchte|danke|bitte)/.test(lower)) return 'German';
  if (/^(hola|buenos|necesito|quiero|gracias|por favor)/.test(lower)) return 'Spanish';
  
  // Türkçe veya bilinmeyen Latin → null (default davranış)
  return null;
}

export async function processMessage(channel, text, history = [], recipientId = null, senderPhone = null) {
  if (!text) return { response: "", usedModel: "none" };

  // 0. State Yönetimi ve Handover Kontrolü
  let state = { phase: PHASES.GREETING, temperature: 'cold' };
  let patientName = '';

  if (senderPhone) {
    state = await getConversationState(senderPhone);
    
    // Lead skorunu DB'den çek (handover kararı için)
    let leadScore = 0;
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sqlScore = neon(process.env.DATABASE_URL);
      const scoreRow = await sqlScore`SELECT score FROM leads WHERE phone_number = ${senderPhone} ORDER BY created_at DESC LIMIT 1`;
      leadScore = scoreRow[0]?.score || 0;
    } catch(e) {}

    // Handover Kontrolü (Ekstrem sinir/şikayet durumları)
    const trigger = checkHandoverTriggers(text, leadScore, state.phase); 
    if (trigger) {
      console.log(`🔥 Ekstrem Handover (veya Yeniden Bildirim) tetiklendi: ${trigger} (skor: ${leadScore})`);
      if (state.phase !== 'handover') {
        state.phase = 'handover'; 
        await updateConversationState(senderPhone, 'handover', state.temperature);
      } else {
        // Eğer hasta zaten handover fazındaysa ve "noldu", "aradınız mı" diye yazıyorsa,
        // phase değişmediği için normal akışta bildirim atılmaz. Bunu manuel tetikliyoruz.
        try {
          const { neon } = await import('@neondatabase/serverless');
          const sqlConv = neon(process.env.DATABASE_URL);
          const cleanP = senderPhone.replace(/\D/g, '');
          const last10 = cleanP.substring(cleanP.length - 10);
          const conv = await sqlConv`SELECT patient_name, department FROM conversations WHERE phone_number LIKE ${'%' + last10 + '%'} LIMIT 1`;
          await executeHandover(senderPhone, trigger, conv[0]?.patient_name, conv[0]?.department, '');
        } catch(e) { console.error('Manuel handover tetikleme hatası:', e.message); }
      }
    }

    // Faz İlerlemesi + Pipeline Stage Senkronizasyonu
    // Form'da zaman bilgisi var mı kontrol et (saat teyidi atlama için)
    let hasFormTimeInfo = false;
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sqlTime = neon(process.env.DATABASE_URL);
      const cleanP = senderPhone.replace(/\D/g, '');
      const last10 = cleanP.substring(cleanP.length - 10);
      const leadRow = await sqlTime`SELECT raw_data FROM leads WHERE phone_number LIKE ${'%' + last10 + '%'} ORDER BY created_at DESC LIMIT 1`;
      if (leadRow.length > 0) {
        const rawStr = JSON.stringify(leadRow[0].raw_data || '').toLowerCase();
        if (/saat|zaman|arayalım|öğle|sabah|akşam|\d{1,2}:\d{2}|\d{1,2}:00/i.test(rawStr)) {
          hasFormTimeInfo = true;
          console.log('⏰ Form\'da zaman bilgisi bulundu → TIME_CONFIRM atlanacak');
        }
      }
    } catch(e) {}
    
    const nextPhase = determineNextPhase(state.phase, text, null, { hasFormTimeInfo });
    if (nextPhase !== state.phase) {
      console.log(`🔄 Faz geçişi: ${state.phase} -> ${nextPhase}`);
      await updateConversationState(senderPhone, nextPhase, state.temperature);
      state.phase = nextPhase;

      // 🎯 Pipeline stage'i bot fazıyla senkronize et
      const phaseToStage = { greeting: 'contacted', discovery: 'discovery', trust: 'negotiation', time_confirm: 'negotiation', handover: 'hot_lead' };
      const newStage = phaseToStage[nextPhase];
      if (newStage) {
        try {
          const { neon } = await import('@neondatabase/serverless');
          const sqlSync = neon(process.env.DATABASE_URL);
          // Telefon format esnekleştirme (LIKE)
          let cleanP = senderPhone.replace(/\D/g, '');
          const searchP = cleanP.length > 10 ? cleanP.substring(cleanP.length - 10) : cleanP;
          const likePattern = `%${searchP}%`;
          
          // Sadece ileri yönde güncelle (geri gitmesin)
          const stageOrder = { new: 0, contacted: 1, discovery: 2, negotiation: 3, hot_lead: 4, appointed: 5, lost: 6 };
          const current = await sqlSync`SELECT stage FROM leads WHERE phone_number LIKE ${likePattern} ORDER BY created_at DESC LIMIT 1`;
          const currentOrder = stageOrder[current[0]?.stage] || 0;
          if (stageOrder[newStage] > currentOrder) {
            await sqlSync`UPDATE leads SET stage = ${newStage} WHERE phone_number LIKE ${likePattern} AND stage NOT IN ('appointed', 'lost')`;
            await sqlSync`UPDATE conversations SET lead_stage = ${newStage} WHERE phone_number LIKE ${likePattern}`;
            console.log(`🎯 Pipeline senkron: ${current[0]?.stage || 'new'} → ${newStage}`);
          }
        } catch(e) { console.error('Pipeline sync hatası:', e.message); }
      }
      
      // EĞER SON AŞAMAYA (HANDOVER) GEÇİLDİYSE TELEGRAM'A BİLDİRİM GÖNDER
      if (nextPhase === 'handover') {
        try {
          const { neon } = await import('@neondatabase/serverless');
          const sql = neon(process.env.DATABASE_URL);
          const cleanP = senderPhone.replace(/\D/g, '');
          const last10 = cleanP.substring(cleanP.length - 10);
          const likeP = `%${last10}%`;
          
          const conv = await sql`SELECT patient_name, department FROM conversations WHERE phone_number LIKE ${likeP} LIMIT 1`;
          if (conv.length > 0) patientName = conv[0].patient_name;
          
          // 🏥 Bölüm: conversations.department yoksa form_name'den tespit et
          let dept = conv[0]?.department || '';
          if (!dept) {
            const leadDept = await sql`SELECT form_name, tags FROM leads WHERE phone_number LIKE ${likeP} ORDER BY created_at DESC LIMIT 1`;
            if (leadDept.length > 0) {
              // Tags'ten tıbbi bölüm
              try {
                const tags = JSON.parse(leadDept[0].tags || '[]');
                dept = tags.filter(t => !['Genel', 'Ortaasya', 'Avrupa', 'Yerli', 'Gurbetçi', 'Yabancı Turist'].includes(t)).join(', ');
              } catch(e) {}
              // Form name'den tespit
              if (!dept && leadDept[0].form_name) {
                const fn = leadDept[0].form_name.toLowerCase();
                const deptMap = [[/ortoped/i,'Ortopedi'],[/kardiyoloji|kalp/i,'Kardiyoloji'],[/estetik/i,'Estetik'],[/di[sş]|implant/i,'Diş'],[/g[oö]z|katarakt/i,'Göz'],[/t[uü]p.?bebek|ivf/i,'Tüp Bebek'],[/nakil|organ/i,'Organ Nakli'],[/onkoloji|kanser/i,'Onkoloji'],[/obezite/i,'Obezite'],[/n[oö]roloji/i,'Nöroloji'],[/[uü]roloji/i,'Üroloji']];
                for (const [re, tag] of deptMap) { if (re.test(fn)) { dept = tag; break; } }
              }
            }
          }
          
          // ⏰ Arama saati: form raw_data'dan çıkar
          let callTime = '';
          try {
            const leadTime = await sql`SELECT raw_data FROM leads WHERE phone_number LIKE ${likeP} ORDER BY created_at DESC LIMIT 1`;
            if (leadTime.length > 0) {
              const raw = typeof leadTime[0].raw_data === 'string' ? JSON.parse(leadTime[0].raw_data || '{}') : (leadTime[0].raw_data || {});
              const rawStr = JSON.stringify(raw).toLowerCase();
              // "saat", "zaman", "arayalım" gibi alanları tara (sistem alanlarını hariç tut)
              for (const [key, val] of Object.entries(raw)) {
                if (['created_time', 'id', 'form_id', 'ad_id', 'leadgen_id', 'campaign_id', 'adset_id'].includes(key)) continue;
                if (/saat|zaman|arayalım|aranma|call|time|when/i.test(key)) {
                  callTime = String(val);
                  break;
                }
              }
              // Alanlardan bulunamadıysa, değerlerden saat pattern'i ara
              if (!callTime) {
                for (const val of Object.values(raw)) {
                  const valStr = String(val);
                  if (/\d{1,2}[:.]\d{2}|sabah|öğle|akşam|her saat|uygun/i.test(valStr) && valStr.length < 50) {
                    callTime = valStr;
                    break;
                  }
                }
              }
            }
          } catch(e) {}
          
          await executeHandover(senderPhone, 'appointment', patientName, dept, callTime);
        } catch(e) { console.error('Execute Handover hatası:', e.message); }
      }
    }
  }

  // 1. Kanal ve sayfa bazlı ayarları al
  let systemPrompt = '';
  
  if (channel === 'whatsapp') {
    systemPrompt = await getSetting('system_prompt_whatsapp');
  } else {
    // Sosyal medya kanalları (Instagram / Messenger)
    if (recipientId) {
      const foreignPageId = await getSetting('foreign_page_id');
      if (foreignPageId && String(recipientId) === String(foreignPageId)) {
        systemPrompt = await getSetting('system_prompt_foreign');
        console.log(`🌍 [${channel}] Yabancı sayfa algılandı (${recipientId}), İngilizce prompt kullanılıyor.`);
      }
    }
    
    // Eğer yabancı sayfa değilse veya recipientId eşleşmediyse Türkçe sosyal medya promptunu kullan
    if (!systemPrompt) {
      systemPrompt = await getSetting('system_prompt_tr');
    }
  }

  // Hiçbir prompt bulunamadıysa varsayılana dön
  if (!systemPrompt) {
    systemPrompt = await getSetting('system_prompt', getDefaultPrompt(channel));
  }

  // Faz özel talimatını prompt'un en üstüne ekle (Eğer state yönetimi varsa)
  const phaseInstruction = getPhaseInstruction(state.phase);
  if (phaseInstruction) {
    systemPrompt = `${phaseInstruction}\n\n---\nGENEL HASTANE BİLGİLERİ (BUNLARI YALNIZCA GEREKİRSE VE FAZ KURALLARINI İHLAL ETMEDEN KULLAN):\n${systemPrompt}`;
  }

  // 🎯 Lead/Form bilgisi varsa AI'a context olarak ekle (TÜM form yanıtları dahil)
  if (senderPhone) {
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon(process.env.DATABASE_URL);
      
      // Telefon formatı normalleştirme — LIKE ile son 10 hane ara (en güvenli yöntem)
      const cleanPhone = senderPhone.replace(/\D/g, '');
      const last10 = cleanPhone.substring(cleanPhone.length - 10);
      const likePattern = `%${last10}%`;
      
      console.log(`🔍 [BRAIN] Lead aranıyor: senderPhone=${senderPhone} → cleanPhone=${cleanPhone} → last10=${last10} → pattern=${likePattern}`);
      
      let leads = await sql`SELECT patient_name, form_name, city, tags, stage, email, raw_data FROM leads WHERE phone_number LIKE ${likePattern} ORDER BY created_at DESC LIMIT 1`;
      
      console.log(`🔍 [BRAIN] Leads sonucu: ${leads.length} kayıt bulundu${leads.length > 0 ? ` → İsim: ${leads[0].patient_name}, Form: ${leads[0].form_name}, Şehir: ${leads[0].city}` : ' → BOŞ!'}`);
      
      // Fallback: leads tablosunda yoksa conversations'dan department/tags bilgisini al
      let convNotes = '';
      let convStatus = 'active';
      const convData = await sql`SELECT patient_name, department, tags, notes, status FROM conversations WHERE phone_number LIKE ${likePattern} LIMIT 1`;
      
      console.log(`🔍 [BRAIN] Conversations sonucu: ${convData.length} kayıt bulundu${convData.length > 0 ? ` → İsim: ${convData[0].patient_name}, Dept: ${convData[0].department}` : ' → BOŞ!'}`);
      
      if (convData.length > 0) {
        convNotes = convData[0].notes || '';
        convStatus = convData[0].status || 'active';
      }

      if (leads.length === 0) {
        if (convData.length > 0 && (convData[0].department || convData[0].tags)) {
          leads = [{ 
            patient_name: convData[0].patient_name, 
            form_name: '', 
            city: '', 
            tags: convData[0].tags || '[]', 
            stage: 'new', 
            email: '', 
            raw_data: '{}' 
          }];
          console.log(`📋 Leads'te kayıt yok, conversations'dan bilgi alındı: ${convData[0].department}`);
        }
      }
      
        if (leads.length > 0) {
          const lead = leads[0];
          let leadTags = [];
          try { leadTags = JSON.parse(lead.tags || '[]'); } catch(e) {}
          
          // Form yanıtlarını temizle ve "Anayasa" olarak hazırla
          let formResponsesText = '';
          try {
            const rawData = typeof lead.raw_data === 'string' ? JSON.parse(lead.raw_data || '{}') : (lead.raw_data || {});
            const skipKeys = ['id', 'leadgen_id', 'form_id', 'ad_id', 'adset_id', 'campaign_id', 'platform', 'is_organic', 'created_time', 'phone_number_id', 'full_name', 'phone_number'];
            const formEntries = Object.entries(rawData)
              .filter(([key]) => !skipKeys.includes(key.toLowerCase()))
              .map(([key, val]) => {
                const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                return `📍 ${readableKey}: ${val}`;
              });
            
            if (formEntries.length > 0) {
              formResponsesText = `\n${formEntries.join('\n')}`;
            }
          } catch(e) { console.error('raw_data parse hatası:', e.message); }

          // 📎 Dosya/Görsel tespit: Mesaj geçmişinde gerçek dosya var mı?
          let hasReceivedFile = false;
          try {
            const fileCheck = await sql`SELECT COUNT(*) as c FROM messages WHERE phone_number LIKE ${likePattern} AND direction = 'in' AND (content LIKE '%[📷%' OR content LIKE '%[📄%')`;
            hasReceivedFile = parseInt(fileCheck[0]?.c || 0) > 0;
          } catch(e) {}

          // 📅 Randevu tespiti: Hastanın randevusu var mı?
          let aptStatusText = '❌ HAYIR — Hastanın henüz planlanmış/onaylanmış bir randevusu yok.';
          try {
            const aptCheck = await sql`SELECT status, scheduled_date FROM events WHERE phone_number LIKE ${likePattern} AND event_type = 'appointment_request' AND status IN ('scheduled', 'confirmed') AND scheduled_date IS NOT NULL ORDER BY created_at DESC LIMIT 1`;
            if (aptCheck.length > 0) {
              const aptDate = new Date(aptCheck[0].scheduled_date);
              const dateStr = aptDate.toLocaleString('tr-TR', {day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
              aptStatusText = `✅ EVET — Hastanın RANDEVUSU VAR. Planlanan Tarih/Saat: ${dateStr}. Hastaya randevusunu hatırlatabilir veya teyit edebilirsin. Eğer randevuyu iptal etmek veya değiştirmek isterse, "Elbette, randevu saatinizi güncellemek için asistanımız/danışmanımız size birazdan ulaşacaktır" diyerek konuyu sonlandır. Sen direkt tarih değiştirme!`;
            }
          } catch(e) {}

          // 🏥 Bölüm tespiti: Tags'te tıbbi bölüm yoksa form_name'den çıkar
          let resolvedDept = leadTags.filter(t => !['Genel', 'Ortaasya', 'Avrupa', 'Yerli', 'Gurbetçi', 'Yabancı Turist'].includes(t)).join(', ');
          if (!resolvedDept && lead.form_name) {
            const fn = lead.form_name.toLowerCase();
            const deptMap = [
              [/ortoped/i, 'Ortopedi'], [/kardiyoloji|kalp/i, 'Kardiyoloji'], [/estetik/i, 'Estetik'],
              [/di[sş]|implant/i, 'Diş'], [/g[oö]z|katarakt/i, 'Göz'], [/t[uü]p.?bebek|ivf/i, 'Tüp Bebek'],
              [/nakil|organ/i, 'Organ Nakli'], [/onkoloji|kanser/i, 'Onkoloji'], [/obezite|bariatrik/i, 'Obezite'],
              [/n[oö]roloji|beyin/i, 'Nöroloji'], [/[uü]roloji|prostat/i, 'Üroloji'], [/check.?up/i, 'Check-Up']
            ];
            for (const [re, tag] of deptMap) {
              if (re.test(fn)) { resolvedDept = tag; break; }
            }
          }

          // ANAYASA KURALI (Constitution Injection)
          const leadContext = `\n\n============================================================
🛑🛑🛑 [HASTA PROFİLİ — KESİN GERÇEKLER (ANAYASA)] 🛑🛑🛑

AŞAĞIDAKİ VERİLER HASTANIN BİZZAT VERDİĞİ BİLGİLER VEYA SİSTEM KAYITLARIDIR.
BU BİLGİLER KESİNDİR VE TEKRAR SORULAMAZ.

⛔ MUTLAK YASAKLAR:
1. Hastaya adını SORMA — zaten biliyorsun.
2. Nerede yaşadığını SORMA — formdan biliyorsun.
3. Hangi bölümle ilgilendiğini SORMA — formdan biliyorsun.
4. Aşağıdaki "HASTANIN KENDİ VERDİĞİ CEVAPLAR" bölümünde yer alan HİÇBİR soruyu TEKRAR SORMA.
   Örneğin hasta formda "MR/röntgen var" dediyse, "MR var mı?" diye TEKRAR SORMA.
   Hasta formda şikayetini yazdıysa, "şikayetiniz nedir?" diye TEKRAR SORMA.
   Hasta formda gelme planını belirttiyse, "ne zaman gelebilirsiniz?" diye TEKRAR SORMA.
5. "Formunuzu inceledim" veya "Formunuz bize ulaştı" gibi ifadeler KULLANMA.
   Doğrudan bu bilgilere göre doğal ve empatik şekilde konuşmaya başla.

📋 Kampanya: ${lead.form_name || 'Bilinmiyor'}
👤 İsim: ${lead.patient_name || 'Bilinmiyor'}
🌍 Şehir/Ülke: ${lead.city || 'Bilinmiyor'}
🏥 İlgilendiği Bölüm: ${resolvedDept || 'Genel'}

📎 DOSYA DURUMU: ${hasReceivedFile 
  ? '✅ EVET — Hasta daha önce görüntü/belge GÖNDERDİ. "Raporlarınız bize ulaştı" diyebilirsin.' 
  : '❌ HAYIR — Hasta henüz HİÇBİR dosya/görüntü GÖNDERMEDİ. "Raporlarınız ulaştı" ASLA DEME. Hasta "gönderdim/paylaştım/attım" derse bile dosya gelmediyse "Henüz bir dosya göremedim, lütfen buradan WhatsApp üzerinden tekrar gönderir misiniz?" de.'}
📅 RANDEVU DURUMU: ${aptStatusText}
${convNotes ? `\n📌 CRM SİSTEM NOTLARI (BUNLARA GÖRE DAVRAN):\n${convNotes}\n\n⚠️ DİKKAT: Yukarıdaki notlar klinik ekibinin loglarıdır. Eğer "ulaşılamadı" veya "arandı" gibi notlar varsa, hasta "Aramadınız" veya "Durumum ne oldu?" dediğinde: "Evet, koordinatör arkadaşlarımız sizi aramış ancak ulaşamamışlar, tekrar iletişime geçecekler" şeklinde empatik ve konuyu bilen bir yanıt ver.` : ''}
${formResponsesText ? `\n📝 HASTANIN KENDİ VERDİĞİ CEVAPLAR (BUNLARI BİLİYORSUN, TEKRAR SORMA):${formResponsesText}` : ''}
============================================================\n\n`;

          // Prompt'un en tepesine enjekte et
          systemPrompt = leadContext + systemPrompt;

          if (convStatus === 'human' && convNotes) {
            systemPrompt += `\n🚨 DİKKAT (SEKRETER MODU): Bu hasta şu an canlı bir danışman/doktor bekliyor.
Sistemdeki son notlar şunlar:
"${convNotes}"

GÖREVİN: Hastaya tıbbi bilgi verme. Sadece notları okuyarak hastaya nazikçe durum bilgisini ver. Örneğin notta "Arandı ulaşılamadı" yazıyorsa hastaya "Sizi az önce aramaya çalıştık ancak ulaşamadık, ne zaman müsaitsiniz?" de.\n`;
        }
        
        // leadContext zaten yukarıda prompt'un başına eklendi, tekrar ekleme
        
        // 🌍 Ülke Bazlı Mikro-Strateji
        const conv = await sql`SELECT patient_type FROM conversations WHERE phone_number = ${senderPhone}`;
        const patientType = conv[0]?.patient_type || 'Yerli';
        
        let countryStrategy = '';
        if (patientType === 'Yabancı Turist') {
          // Dil tespitine göre strateji
          const detLang = detectLanguageFromText(text);
          if (detLang === 'Arabic') {
            countryStrategy = `\n🇯🇴 ÜLKE STRATEJİSİ (Arap Ülkeleri): Fiyat hassasiyeti yüksek. "Üniversite hastanesi olarak özel hastanelere ve Avrupa'ya göre çok daha uygun fiyatlarla tedavi sunuyoruz" vurgusunu yap. Ücretsiz ön değerlendirme kancasını kullan.\n`;
          } else if (detLang === 'German') {
            countryStrategy = `\n🇩🇪 ÜLKE STRATEJİSİ (Almanya/Avusturya): Tatil planıyla birleştir. "Bayram/tatil döneminde gelin, tek seferde halledelim" yaklaşımını kullan. Kalite + uygun fiyat dengesini vurgula.\n`;
          } else if (detLang === 'English') {
            countryStrategy = `\n🇬🇧 ÜLKE STRATEJİSİ (İngilizce Konuşan): Kalite odaklı. "30+ years of academic excellence, JCI accreditation standards" vurgula. Profesyonel, net, data-driven konuş.\n`;
          } else if (detLang === 'French') {
            countryStrategy = `\n🇫🇷 ÜLKE STRATEJİSİ (Frankofon): Kalite + Kültür. "Centre hospitalier universitaire de référence" vurgula. Fransızca medikal terminolojiyi doğru kullan.\n`;
          } else if (detLang === 'Russian') {
            countryStrategy = `\n🇷🇺 ÜLKE STRATEJİSİ (Rusya/BDT): Medikal turizm paketi. "Полный пакет: перелёт, трансфер, проживание, переводчик" sun. VIP hizmet algısı oluştur.\n`;
          } else {
            countryStrategy = `\n🌍 ÜLKE STRATEJİSİ (Uluslararası): Transfer, konaklama, tercüman desteği sun. "All-inclusive medical tourism package" vurgula. Hastanın ülkesinden daha önce gelen hasta sayısını (varsa) paylaş.\n`;
          }
        } else if (patientType === 'Gurbetçi') {
          countryStrategy = `\n🌍 ÜLKE STRATEJİSİ (Gurbetçi): Tatil dönemine odaklan. "Bayramda/yazın geldiğinizde tek seferde halledelim" de. Aile ziyareti + tedavi kombine planla. Hemşehri sıcaklığında konuş.\n`;
        }
        
        if (countryStrategy) {
          systemPrompt += countryStrategy;
        }
        
        console.log(`📋 [${channel}] Lead bilgisi + form yanıtları AI'a enjekte edildi: ${lead.form_name} (${patientType})`);
      }
    } catch(e) { console.error('Lead context hatası:', e.message); }
  }

  const primaryModel = await getSetting('ai_model', 'gemini-2.5-flash');
  const models = [primaryModel, 'gemini-2.5-flash-lite']; // Fallback: daha hafif model

  const languageInstruction = `⚠️ MANDATORY LANGUAGE RULE — ABSOLUTE PRIORITY ⚠️
You MUST detect the language of the user's LAST message and respond ENTIRELY in that SAME language.
This rule OVERRIDES everything else in this prompt. Even though this prompt is written in Turkish/English, you must ALWAYS match the user's language.

EXAMPLES:
- User writes "مرحبا" → You respond in Arabic (العربية)
- User writes "مرحبا، أنا أحتاج لعملية" → You respond fully in Arabic
- User writes "Hello" → You respond in English
- User writes "Здравствуйте" → You respond in Russian
- User writes "Merhaba" → You respond in Turkish
- User writes "Bonjour" → You respond in French
- User writes "Hallo" → You respond in German

NEVER respond in Turkish unless the user wrote in Turkish. NEVER mix languages. The ENTIRE response must be in the user's language.
---

`;

  let botResponse = "";
  let usedModel = "";
  let aiSuccess = false;

  // Kullanıcının dilini tespit et
  const detectedLang = detectLanguageFromText(text);
  
  // Dil Türkçe değilse, geçmişe model yanıtı ekle + modeli yükselt
  let effectiveModels = models;
  let fullHistory;
  
  if (detectedLang) {
    console.log(`🌐 [${channel}] Dil tespit edildi: ${detectedLang} — model yükseltiliyor`);
    // flash-lite dil değiştirmeyi başaramıyor, flash'a yükselt
    effectiveModels = ['gemini-2.5-flash', 'gemini-2.5-pro'];
    
    // Geçmişe sahte model yanıtı ekle (en güçlü sinyal)
    fullHistory = [
      ...history,
      { role: 'model', parts: [{ text: `[I understand. The patient speaks ${detectedLang}. I will now respond ONLY in ${detectedLang}.]` }] },
      { role: 'user', parts: [{ text: text }] }
    ];
  } else {
    fullHistory = [...history, { role: 'user', parts: [{ text: text }] }];
  }

  // 2. Gemini'ye istek at
  for (const model of effectiveModels) {
    try {
      console.log(`🤖 [${channel}] Deneniyor: ${model}`);
      const r = await axios({
        method: 'POST',
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        headers: { 'Content-Type': 'application/json' },
        data: {
          systemInstruction: {
            parts: [{ text: `${languageInstruction}${systemPrompt}` }]
          },
          contents: fullHistory,
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        },
        timeout: 15000
      });

      if (r.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        botResponse = r.data.candidates[0].content.parts[0].text;
        usedModel = model;
        console.log(`✅ [${channel}] Cevap alındı (${model})`);
        aiSuccess = true;
        break; // İlk başarılı modelde döngüden çık
      }
    } catch (e) {
      console.error(`❌ [${channel}] ${model} hatası:`, e.response?.data?.error?.message || e.message);
    }
  }

  // 3. AI çuvallarsa Fallback mesaj
  if (!aiSuccess) {
    botResponse = "Merhaba, size en kısa sürede dönüş yapacağız.";
    usedModel = "fallback";
  }

  return { response: botResponse, usedModel };
}

// 🏷️ Konuşma analizi — otomatik etiket + randevu tespiti + lead scoring + yapılandırılmış veri
export async function analyzeConversation(phone, lastUserMsg, lastBotMsg) {
  const { sql } = await import('../db/index.js');
  if (!sql) return { tags: [], appointmentRequested: false, score: 0 };

  const userText = String(lastUserMsg || '').toLowerCase();
  const tags = [];
  const departments = [];
  let patient_type = 'Yerli'; // Varsayılan
  let appointmentRequested = false;
  let score = 0;

  // Bölüm tespiti + scoring (Sadece kullanıcının mesajından analiz et)
  const depts = [
    { re: /ortopedi|bel fıtığı|omurga|diz|kalça|kırık|eklem/i, tag: 'Ortopedi', pts: 15 },
    { re: /kardiyoloji|kalp|tansiyon|stent|anjio|bypass/i, tag: 'Kardiyoloji', pts: 20 },
    { re: /estetik|burun|yüz germe|liposuction|botox|dolgu|meme/i, tag: 'Estetik', pts: 15 },
    { re: /diş|implant|ortodonti|kanal tedavi|çekim|zirkonyum/i, tag: 'Diş', pts: 12 },
    { re: /göz|katarakt|lazer|retina|lens/i, tag: 'Göz', pts: 15 },
    { re: /tüp bebek|ivf|kısırlık|gebelik|doğum|kadın/i, tag: 'Tüp Bebek', pts: 25 },
    { re: /nakil|organ|böbrek|karaciğer|haberal/i, tag: 'Organ Nakli', pts: 40 },
    { re: /onkoloji|kanser|tümör|kemoterapi/i, tag: 'Onkoloji', pts: 30 },
    { re: /obezite|mide küçültme|sleeve|bariatrik/i, tag: 'Obezite', pts: 20 },
    { re: /nöroloji|beyin|baş ağrısı|epilepsi|ms/i, tag: 'Nöroloji', pts: 18 },
    { re: /üroloji|prostat|böbrek taşı|mesane/i, tag: 'Üroloji', pts: 15 },
    { re: /check.?up|genel kontrol|tarama/i, tag: 'Check-Up', pts: 8 }
  ];
  depts.forEach(d => { 
    if (d.re.test(userText)) { 
      if (!departments.includes(d.tag)) departments.push(d.tag);
      score += d.pts; 
    } 
  });

  // Fiyat sorgusu → özel etiket
  if (/fiyat|ücret|ne kadar|maliyet|price|cost|كم|سعر|цена/i.test(userText)) { tags.push('Fiyat Sordu'); score += 10; }

  // Hasta Tipi Tespiti (Gurbetçi / Yabancı / Yerli)
  if (/almanya|deutschland|germany|hollanda|fransa|belçika|avusturya|ingiltere|isviçre|gurbetçi|abroad|yurtdışı/i.test(userText)) { 
    patient_type = 'Gurbetçi'; 
    score += 30; 
  } else if (phone && !phone.startsWith('90') && !phone.startsWith('test')) {
    patient_type = 'Yabancı Turist';
    score += 20;
  }

  // 🎯 ENGAGEMENT BAZLI PUANLAMA (Mesaj sayısı, uzunluk, tetkik paylaşımı)
  try {
    const msgStats = await sql`
      SELECT 
        COUNT(*) FILTER (WHERE direction = 'in') as patient_msgs,
        COUNT(*) FILTER (WHERE direction = 'out') as bot_msgs,
        MAX(CASE WHEN direction = 'in' AND content LIKE '%📷%' THEN 1 ELSE 0 END) as shared_image,
        MAX(CASE WHEN direction = 'in' AND content LIKE '%📄%' THEN 1 ELSE 0 END) as shared_document
      FROM messages WHERE phone_number = ${phone}
    `;
    if (msgStats.length > 0) {
      const stats = msgStats[0];
      const patientMsgCount = parseInt(stats.patient_msgs) || 0;
      
      // Mesaj sayısı bonusu (aktif hasta = ilgili hasta)
      if (patientMsgCount >= 3) score += 5;
      if (patientMsgCount >= 6) score += 10;
      if (patientMsgCount >= 10) score += 15;
      
      // Tetkik/MR/Belge paylaştıysa → çok ilgili
      if (parseInt(stats.shared_image) === 1) { score += 20; tags.push('Tetkik Paylaştı'); }
      if (parseInt(stats.shared_document) === 1) { score += 20; tags.push('Belge Paylaştı'); }
    }
  } catch(e) {}

  // Mesaj uzunluğu bonusu (detaylı yazan hasta = ciddi hasta)
  if (userText.length > 100) score += 5;
  if (userText.length > 200) score += 10;

  // Randevu / İlgi Talebi (İkiye ayrıldı: İLGİ vs KESİN NİYET)
  // ÖNEMLİ: Bot ASLA 'appointed' yapmaz. En fazla 'hot_lead'. Appointed sadece insan tetikler.
  let interestShown = false;
  
  // Kesin niyet: Hasta geleceğini açıkça söylüyor
  const confirmPat = /geleceğim|geliyorum|gelirim|hemen gel|ayarlayın|ayarlayalım|planlayalım|onaylıyorum|kabul/i;
  if (confirmPat.test(userText)) { appointmentRequested = true; interestShown = true; score += 25; }
  
  // İlgi sinyali: Hasta soruyor, ilgileniyor ama kesinleştirmedi
  const interestPat = /randevu|appointment|موعد|запись|termin|rendez|müsait|ne zaman|gelebilir|gelmek istiyorum|görüşelim|görşelim|uygun|saat\s*\d+|tarih|sabah|öğle|akşam|yarın|bugün/i;
  if (!appointmentRequested && interestPat.test(userText)) { interestShown = true; score += 15; }
  
  // Kısa onay ("olur", "tamam") — sadece tek başına kısa mesajsa ilgi sinyali say
  if (!appointmentRequested && !interestShown && /olur|tamam|evet|uygun/i.test(userText) && userText.length < 30) { 
    interestShown = true; score += 10; 
  }

  // Kaybedilen hasta
  const lostPat = /istemiyorum|gerek yok|başka hastane|başka yere|vazgeçtim|iptal|cancel|no thanks|لا شكرا|не нужно|kein interesse|pas intéressé|almıyorum|gitmeye.*karar|başka.*(doktor|yer)/i;
  let isLost = false;
  if (lostPat.test(userText) && !appointmentRequested && !interestShown) { 
    isLost = true;
    score = Math.max(score - 50, 0); 
  }

  // DB güncelle
  try {
    const conv = await sql`SELECT tags, department, patient_type FROM conversations WHERE phone_number = ${phone}`;
    let existingTags = [];
    try { existingTags = JSON.parse(conv[0]?.tags || '[]'); } catch(e) {}
    const mergedTags = [...new Set([...existingTags, ...tags])];
    
    // Eski sistemden kalma karışık etiketleri temizle (Artık yapılandırılmış alanlara geçildi)
    const cleanTags = mergedTags.filter(t => !['Gurbetçi', 'Yabancı Turist', 'Yerli', 'Kaybedildi', 'Randevu İstiyor'].includes(t) && !depts.find(d => d.tag === t));

    const finalDepts = [...new Set([...(conv[0]?.department?.split(',') || []).filter(Boolean).map(x=>x.trim()), ...departments])].join(', ');
    const finalPatientType = (patient_type !== 'Yerli' || !conv[0]?.patient_type) ? patient_type : conv[0].patient_type;

    await sql`UPDATE conversations SET tags = ${JSON.stringify(cleanTags)}, department = ${finalDepts}, patient_type = ${finalPatientType} WHERE phone_number = ${phone}`;

    // Lead score ve STAGE (Süreç) güncelle
    try { await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS score INT DEFAULT 0`; } catch(e) {}
    let clP = (phone || '').replace(/\D/g, '');
    const sP = clP.length > 10 ? clP.substring(clP.length - 10) : clP;
    const lPat = `%${sP}%`;
    await sql`UPDATE leads SET score = GREATEST(COALESCE(score, 0), ${score}) WHERE phone_number LIKE ${lPat}`;
    
    // Skoru conversations tablosuna da yaz (Telegram bildirimi buradan okur)
    try { await sql`UPDATE conversations SET lead_score = GREATEST(COALESCE(lead_score, 0), ${score}) WHERE phone_number LIKE ${lPat}`; } catch(e) {}

    // Otomatik Stage (Süreç Durumu) İlerletme
    // ÖNEMLİ: Bot ASLA 'appointed' yapmaz. En fazla 'hot_lead'.
    if (isLost) {
      await sql`UPDATE leads SET stage = 'lost' WHERE phone_number LIKE ${lPat} AND stage NOT IN ('appointed', 'lost')`;
    } else if (appointmentRequested || interestShown) {
      // Kesin niyet veya ilgi → hot_lead (appointed DEĞİL)
      await sql`UPDATE leads SET stage = 'hot_lead' WHERE phone_number LIKE ${lPat} AND stage NOT IN ('appointed', 'lost')`;
    } else {
      // Sadece iletişim kurulduysa ve yeni formsa discovery'ye çek
      await sql`UPDATE leads SET stage = 'discovery' WHERE phone_number LIKE ${lPat} AND stage = 'new'`;
    }

    if (appointmentRequested) {
      // 🔥 OTOMATİK HANDOVER: Hasta randevu istiyorsa botu durdur + insana devret
      try {
        let cleanP = (phone || '').replace(/\D/g, '');
        const searchP = cleanP.length > 10 ? cleanP.substring(cleanP.length - 10) : cleanP;
        const likePattern = `%${searchP}%`;
        await sql`UPDATE conversations SET status = 'human', temperature = 'hot', phase = 'handover' WHERE phone_number LIKE ${likePattern}`;
        console.log(`🔥 [analyzeConversation] Randevu talebi → Otomatik handover: ${phone}`);
      } catch(e) {}

      try {
        await sql`CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, phone_number VARCHAR(20), event_type VARCHAR(50), details TEXT, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`;
        // Sadece aktif randevusu varsa yenisini açma
        const activeEvent = await sql`SELECT id FROM events WHERE phone_number = ${phone} AND event_type = 'appointment_request' AND status IN ('pending', 'scheduled', 'confirmed')`;
        if (activeEvent.length === 0) {
          await sql`INSERT INTO events (phone_number, event_type, details, status) VALUES (${phone}, 'appointment_request', ${userText.substring(0, 500)}, 'pending')`;
        }
      } catch(e) {}
    }

    // 🔴 SICAK LEAD ALARMI — Randevu talebi veya yüksek skor
    if (appointmentRequested || score >= 50) {
      try {
        await sql`CREATE TABLE IF NOT EXISTS alerts (id SERIAL PRIMARY KEY, phone_number VARCHAR(20), alert_type VARCHAR(50), message TEXT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`;
        const patientName = conv[0]?.patient_name || phone;
        const alertMsg = appointmentRequested 
          ? `🔔 ${patientName} RANDEVU İSTİYOR! Hemen arayın. Bölüm: ${finalDepts || 'Genel'}`
          : `🔥 Yüksek skorlu lead: ${patientName} (Skor: ${score}). Bölüm: ${finalDepts || 'Genel'}`;
        await sql`INSERT INTO alerts (phone_number, alert_type, message) VALUES (${phone}, ${appointmentRequested ? 'appointment_request' : 'hot_lead'}, ${alertMsg})`;
        console.log(`\n🚨🚨🚨 SICAK LEAD ALARMI 🚨🚨🚨\n${alertMsg}\nTelefon: ${phone}\n`);
      } catch(e) { console.error('Alert hatası:', e.message); }
    }

    console.log(`🏷️ ${phone} → Dep:[${finalDepts}] Tip:[${finalPatientType}] Özel:[${cleanTags.join(',')}] 📊 Skor:${score}${appointmentRequested ? ' 🔔 RANDEVU' : ''}`);
  } catch(e) { console.error('Etiket hatası:', e.message); }

  return { tags, appointmentRequested, score, department: departments.join(', '), patient_type };
}
