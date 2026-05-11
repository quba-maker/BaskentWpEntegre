/* ========== QUOTE ENGINE (HIZLI TEKLİF) ========== */
async function generateAndSendQuote() {
  if (!currentPhone) return toast('Lütfen bir sohbet seçin', 'error');
  
  const treatment = document.getElementById('quote-treatment').value || 'Genel Tedavi';
  const price = document.getElementById('quote-price').value || '0';
  const currency = document.getElementById('quote-currency').value;
  
  const incHotel = document.getElementById('quote-inc-hotel').checked;
  const incTransfer = document.getElementById('quote-inc-transfer').checked;
  const incTranslator = document.getElementById('quote-inc-translator').checked;

  const btn = document.getElementById('quote-send-btn');
  btn.textContent = 'PDF Oluşturuluyor...';
  btn.disabled = true;

  try {
    // Kaydedilmiş şablon ayarlarını yükle
    let qtSettings = {};
    try { qtSettings = await api('settings') || {}; } catch(e) {}
    
    const hospitalName = qtSettings.qt_hospital_name || 'BAŞKENT ÜNİVERSİTESİ';
    const hospitalSub = qtSettings.qt_hospital_subtitle || 'KONYA HASTANESİ';
    const patientName = document.getElementById('chat-title').textContent || 'Sayın Hastamız';
    const introText = (qtSettings.qt_intro_text || 'Sayın {hasta_adi}, hastanemize göstermiş olduğunuz ilgi için teşekkür ederiz. Uzman hekimlerimiz tarafından yapılan ön değerlendirme sonucunda sizin için hazırlanan tedavi planı ve teklifi aşağıda sunulmuştur.').replace(/{hasta_adi}/g, patientName);
    const footerNote = qtSettings.qt_footer_note || 'Bu teklif bir ön bilgilendirme niteliğindedir. Hastanın hastanemize gelişinde yapılacak detaylı tetkikler sonucunda tedavi planında ve fiyatlarda değişiklik olabilir. Kesin fiyat, yüz yüze muayene sonrası belirlenecektir.';
    const footerAddress = qtSettings.qt_footer_address || 'Başkent Üniversitesi Konya Uygulama ve Araştırma Merkezi | Hocacihan Mah. Saray Cad. No:1 Selçuklu / KONYA | +90 332 257 06 06';
    const validityDays = qtSettings.qt_validity_days || '30';
    const waMessage = qtSettings.qt_wa_message || 'Merhaba, uzman hekimlerimizin değerlendirmesi sonucunda size özel hazırlanan tedavi teklifini ekte bulabilirsiniz. Detaylı bilgi için bize her zaman yazabilirsiniz.';

    // PDF Şablonunu dinamik olarak doldur
    const pdfEl = document.getElementById('pdf-document');
    const headerEl = pdfEl.querySelector('.pdf-header > div:first-child');
    headerEl.innerHTML = `<span style="font-size:28px; font-weight:bold; color:#002e5b">${hospitalName}</span><br><span style="font-size:14px; font-weight:normal; color:#555">${hospitalSub}</span>`;
    
    document.getElementById('pdf-date').textContent = new Date().toLocaleDateString('tr-TR');
    pdfEl.querySelector('.pdf-header-info').innerHTML = `Tarih: ${new Date().toLocaleDateString('tr-TR')}<br>Geçerlilik: ${validityDays} Gün`;
    
    document.getElementById('pdf-patient-name').textContent = patientName;
    pdfEl.querySelector('.pdf-patient-info').innerHTML = `Sayın <b>${patientName}</b>,<br><br>${introText}`;
    
    document.getElementById('pdf-treatment-name').textContent = treatment;
    document.getElementById('pdf-treatment-price').textContent = currency + price;
    document.getElementById('pdf-total-price').textContent = currency + price;

    const includesList = document.getElementById('pdf-includes-list');
    includesList.innerHTML = `
      <li>Tıbbi Değerlendirme ve Doktor Görüşmeleri</li>
      <li>Hastanede Yatış ve Hemşirelik Hizmetleri</li>
      <li>Gerekli İlaçlar ve Tıbbi Malzemeler</li>
      ${incHotel ? '<li>🏨 5 Yıldızlı Otelde Konaklama</li>' : ''}
      ${incTransfer ? '<li>🚙 Havalimanı - Otel - Hastane VIP Transfer</li>' : ''}
      ${incTranslator ? '<li>🗣️ 7/24 Kişisel Tercüman ve Asistanlık</li>' : ''}
    `;

    // Footer note ve adres güncelle
    const footerNoteEl = pdfEl.querySelector('.pdf-includes + div');
    if (footerNoteEl) footerNoteEl.innerHTML = `<b>Not:</b> ${footerNote}`;
    const footerEl = pdfEl.querySelector('.pdf-footer');
    if (footerEl) footerEl.textContent = footerAddress;

    // PDF Oluştur
    const element = document.getElementById('pdf-document');
    const opt = {
      margin: 0,
      filename: `${hospitalName.replace(/\s+/g, '_')}_Teklif_${treatment.replace(/\s+/g, '_')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'px', format: [800, 1120], orientation: 'portrait' }
    };

    // Blob olarak al
    const pdfBlob = await html2pdf().set(opt).from(element).output('blob');
    
    // Base64'e çevir (Server'a kolay atmak için)
    const reader = new FileReader();
    reader.readAsDataURL(pdfBlob);
    reader.onloadend = async () => {
      const base64data = reader.result;
      
      btn.textContent = 'WhatsApp\'a Gönderiliyor...';
      
      // API'ye yolla
      const response = await fetch('/api/send-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + AUTH_TOKEN
        },
        body: JSON.stringify({
          phone: currentPhone,
          channel: currentChannel,
          fileName: opt.filename,
          pdfBase64: base64data,
          message: waMessage
        })
      });

      const resData = await response.json();
      if (response.ok) {
        toast('Teklif başarıyla gönderildi!');
        document.getElementById('quote-modal').classList.remove('active');
        document.getElementById('chat-input').value = '';
        setTimeout(() => loadChat(currentPhone, currentChannel), 1000);
      } else {
        toast('Hata: ' + (resData.error || 'Gönderilemedi'), 'error');
      }
      
      btn.textContent = 'PDF Oluştur ve Gönder';
      btn.disabled = false;
    };
  } catch (error) {
    console.error('PDF Hatası:', error);
    toast('PDF oluşturulamadı', 'error');
    btn.textContent = 'PDF Oluştur ve Gönder';
    btn.disabled = false;
  }
}

async function sendPanelMessage() {
  // Dosya varsa dosya gönder
  if (pendingFile) { await sendFileMessage(); return; }
  
  const i = document.getElementById('chat-input');
  const m = i.value.trim();
  if(!m || !currentPhone) return;
  i.value = '';
  try {
    const r = await fetch(`/api/panel?action=send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AUTH_TOKEN },
      body: JSON.stringify({phone:currentPhone, message:m, channel:currentChannel})
    });
    const data = await r.json();
    if (data.error) { toast('❌ ' + data.error, 'error'); return; }
    toast('Mesaj gönderildi ✅');
    loadChat(currentPhone, currentChannel);
  } catch(e) { toast('Bağlantı hatası', 'error'); }
}

