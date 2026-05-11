/* LEADS */
async function loadLeads() {
  const stats = await api('lead-stats');
  if(stats){
    document.getElementById('lead-today').textContent = stats.todayLeads;
    document.getElementById('lead-total').textContent = stats.totalLeads;
    const stageMap = {};
    (stats.byStage || []).forEach(st => stageMap[st.stage] = +st.count);
    document.getElementById('lead-contacted').textContent = stageMap.contacted || 0;
    document.getElementById('lead-appointed').textContent = stageMap.appointed || 0;
  }
  loadSheets();
}

function openLeadDetail(rowIndex) {
  // rowIndex artık doğrudan orijinal satır index'i (origIdx)
  const headers = window._sheetHeaders;
  const row = window._sheetRows[rowIndex];
  if (!headers || !row) return;
  
  // Form satır verisini sakla (triggerSingleOutbound'da kullanılır)
  window._currentLeadRowData = row;
  window._currentLeadRowData_rowIndex = rowIndex;

  // Meta reklam teknik alanları (açılır menüye taşınacak)
  const metaCols = ['ad_name', 'adset_name', 'adset_id', 'campaign_name', 'campaign_id', 'form_name', 'form_id', 'ad_id', 'leadgen_id', 'is_organic', 'platform', 'id'];
  let statusColIndex = -1;
  let notesColIndex = -1;
  
  // İsim sütunu: full_name / isim öncelikli (ad_name Meta reklam adıdır!)
  const findColDetail = (keywords) => headers.findIndex(h => {
    const l = h.toLowerCase().replace(/[_\s]+/g, '');
    return keywords.some(k => l.includes(k));
  });
  let nameCol = findColDetail(['fullname', 'full_name', 'isim', 'hastadi', 'hastaadi']);
  if (nameCol === -1) nameCol = headers.findIndex(h => /^ad$/i.test(h.trim()) || h.toLowerCase().includes('isim'));
  // phone_number veya phone sütunu (phone_number_id gibi Meta ID alanlarını dışla)
  let phoneCol = headers.findIndex(h => {
    const l = h.toLowerCase().replace(/[_\s]+/g, '');
    return l === 'phonenumber' || l === 'phone' || l === 'telefon' || l === 'tel' || l === 'gsm' || l === 'cep';
  });
  // E-posta sütunu (kullanılmıyor ama skip etmek için tespit ediyoruz)
  let emailCol = headers.findIndex(h => h.toLowerCase().includes('email') || h.toLowerCase().includes('e-posta') || h.toLowerCase().includes('eposta'));
  let dateCol = findColDetail(['time', 'tarih', 'created', 'date', 'zaman']);
  let campaignNameCol = findColDetail(['campaignname', 'campaign_name']);
  
  const nameVal = nameCol > -1 ? (row[nameCol] || 'Bilinmiyor') : 'Bilinmiyor';
  const phoneVal = phoneCol > -1 ? (row[phoneCol] || '') : '';
  const emailVal = emailCol > -1 ? (row[emailCol] || '') : '';
  const campaignNameVal = campaignNameCol > -1 ? (row[campaignNameCol] || '') : '';

  // Tarih formatlama: 🗓 09 May 2026 - 15:31
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let dateDisplay = '';
  if (dateCol > -1 && row[dateCol]) {
    const d = new Date(row[dateCol]);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const mon = monthNames[d.getMonth()];
      const year = d.getFullYear();
      const hour = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      dateDisplay = `${day} ${mon} ${year} - ${hour}:${min}`;
    }
  }

  // 📞 TÜM FORM ALANLARINDAN TELEFON NUMARASI TESPİT ET
  const phoneNumbers = [];
  const phoneRegex = /(\+?\d[\d\s\-().]{7,}\d)/g;
  const normalizePhone = (p) => p.replace(/\D/g, '');
  const formatPhoneDisplay = (num) => {
    // 905546833306 → +90 554 683 33 06
    if (num.length >= 10) {
      if (num.startsWith('90') && num.length >= 12) return '+' + num.substring(0,2) + ' ' + num.substring(2,5) + ' ' + num.substring(5,8) + ' ' + num.substring(8,10) + ' ' + num.substring(10);
      return '+' + num;
    }
    return num;
  };
  const seenPhones = new Set();

  if (phoneVal) {
    const clean = normalizePhone(phoneVal);
    seenPhones.add(clean);
    phoneNumbers.push({ number: clean, label: 'WhatsApp', isWhatsApp: true, raw: formatPhoneDisplay(clean) });
  }

  // SADECE açıkça telefon/whatsapp olarak adlandırılmış alanlardan numara al
  // (Meta reklam ID'lerini yakalamayı engeller)
  headers.forEach((h, j) => {
    if (j === phoneCol || j === nameCol || j === emailCol) return;
    const val = row[j] || '';
    const lower = h.toLowerCase().replace(/[\s_]+/g, '');
    const isWA = lower.includes('whatsapp') || lower.includes('wp') || lower.includes('wapp');
    const isTelField = lower === 'phonenumber';
    const isPhoneField = isWA || isTelField || lower.includes('telefon') || lower === 'phone' || lower.includes('numara') || lower.includes('gsm') || lower.includes('cep') || lower.includes('iletişim') || lower.includes('iletisim');
    // SADECE telefon/whatsapp alanlarından numara çıkar
    if (!isPhoneField) return;
    const matches = val.match(phoneRegex);
    if (matches) {
      matches.forEach(m => {
        const clean = normalizePhone(m);
        if (clean.length >= 10 && !seenPhones.has(clean)) {
          seenPhones.add(clean);
          phoneNumbers.push({ number: clean, label: isTelField ? 'Telefon' : (isWA ? 'WhatsApp' : 'Telefon'), isWhatsApp: !isTelField && isWA, raw: formatPhoneDisplay(clean) });
        }
      });
    }
  });

  // Aynı numaralar varsa sadece WhatsApp olarak göster
  const uniquePhones = [];
  const phoneMap = {};
  phoneNumbers.forEach(p => {
    if (!phoneMap[p.number]) {
      phoneMap[p.number] = p;
      uniquePhones.push(p);
    } else if (p.isWhatsApp && !phoneMap[p.number].isWhatsApp) {
      // WhatsApp olanı tercih et
      phoneMap[p.number].label = 'WhatsApp';
      phoneMap[p.number].isWhatsApp = true;
    }
  });

  if (phoneVal) {
    let readLeads = JSON.parse(localStorage.getItem('readLeads') || '[]');
    if (!readLeads.includes(phoneVal)) { readLeads.push(phoneVal); localStorage.setItem('readLeads', JSON.stringify(readLeads)); }
  }

  const phonesHtml = uniquePhones.length > 0 ? uniquePhones.map(p => `
    <div style="display:flex; align-items:center; gap:8px; padding:6px 0;">
      <div style="flex:1;">
        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase;">${p.isWhatsApp ? 'WHATSAPP' : 'TELEFON'}</div>
        <div style="font-size:15px; color:${p.isWhatsApp ? '#25D366' : '#60a5fa'}; font-weight:500; display:flex; align-items:center; gap:6px;">
          ${p.isWhatsApp ? '🟢' : '📞'} ${p.raw} ${countryBadge(p.number)}
        </div>
      </div>

    </div>
  `).join('') : `<div style="font-size:13px; color:var(--text-muted);">📱 Telefon bulunamadı</div>`;

  const primaryPhone = phoneNumbers.length > 0 ? phoneNumbers[0].number : '';

  // Kampanya ve tarih başlık bilgisi
  const campaignBadgeHtml = campaignNameVal ? `<span style="background:rgba(191,90,242,0.2); color:#bf5af2; padding:4px 12px; border-radius:8px; font-size:12px; font-weight:600;">📣 ${campaignNameVal}</span>` : '';
  const dateHtml = dateDisplay ? `<span style="font-size:13px; color:var(--text-muted);">🗓 ${dateDisplay}</span>` : '';

  let detailsHtml = `
    <div style="display:grid; grid-template-columns: 2fr 1fr; gap:32px;">
      <!-- SOL PANEL -->
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:12px; padding:20px;">
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px; flex-wrap:wrap;">
            <h2 style="margin:0; color:white; font-size:20px;">👤 ${nameVal}</h2>
            ${campaignBadgeHtml}
          </div>
          <div style="margin-bottom:16px;">
            ${dateHtml}
          </div>
          <div style="margin-bottom:16px; border-bottom:1px solid var(--border-color); padding-bottom:16px;">
            ${phonesHtml}
          </div>
          <div style="display:flex; gap:12px; flex-wrap:wrap;">
            <button onclick="navigateToChat('${primaryPhone}')" class="btn" style="background:#25D366; color:white; border:none; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;">
              💬 Mesaj Bölümüne Git
            </button>
          </div>
        </div>
  `;

  // === FORM YANITLARI BÖLÜMÜ ===
  // Alanları kategorize et: önemli form soruları vs meta reklam bilgileri vs diğer
  const importantQuestionKeys = ['ülke', 'ulke', 'yaşıyor', 'yasiyor', 'tetkik', 'tedavi', 'şikayet', 'sikayet', 'hastalık', 'hastalik', 'bölüm', 'bolum', 'departman', 'kalp', 'heart', 'geliş', 'gelis', 'randevu', 'appointment', 'planlama', 'arayalım', 'arayalim', 'birth', 'doğum', 'dogum', 'konya', 'mr', 'emar', 'röntgen', 'rontgen', 'görüntü', 'goruntu'];
  const metaFieldKeys = ['ad_name', 'adset_name', 'adset_id', 'campaign_name', 'campaign_id', 'form_name', 'form_id'];
  
  const importantFields = [];
  const metaFields = [];
  const otherFields = [];

  headers.forEach((h, j) => {
    const lower = h.toLowerCase().replace(/\s+/g, '_');
    // Status ve notlar ayrı yönetiliyor
    if (lower.includes('lead_status') || lower.includes('leadstatus') || lower === 'durum' || lower === 'aşama') { statusColIndex = j; return; }
    if (lower.includes('geri_dönüş') || lower.includes('geri_donus') || lower.includes('geri dönüş') || lower === 'notlar') { notesColIndex = j; return; }
    // İletişim kartında zaten gösterilen alanları atla
    if (j === nameCol || j === phoneCol || j === emailCol || j === dateCol || j === campaignNameCol) return;
    // Teknik ID alanlarını atla (metaCols'ta olmayanlar)
    const lowerClean = lower.replace(/_/g, '');
    if (['id', 'leadgenid', 'isorganic', 'platform'].some(tc => lowerClean === tc || lower === tc)) return;

    const val = row[j] || '—';
    const fieldObj = { header: h, value: val };

    // Meta reklam bilgisi mi?
    if (metaFieldKeys.some(mk => lower.includes(mk.replace(/_/g, '')) || lower === mk.replace(/_/g, ''))) {
      metaFields.push(fieldObj);
      return;
    }
    // Önemli form sorusu mu?
    if (importantQuestionKeys.some(ik => lower.includes(ik))) {
      importantFields.push(fieldObj);
      return;
    }
    otherFields.push(fieldObj);
  });

  // Önemli Form Soruları (üstte, belirgin)
  if (importantFields.length > 0) {
    detailsHtml += `
        <div style="background:linear-gradient(135deg, rgba(10,132,255,0.08), rgba(191,90,242,0.08)); border:1px solid rgba(10,132,255,0.3); border-radius:12px; padding:16px;">
          <h3 style="margin:0 0 12px 0; font-size:15px; color:var(--accent-primary); display:flex; align-items:center; gap:8px;">⭐ Önemli Form Bilgileri</h3>
          <div style="display:flex; flex-direction:column; gap:10px;">
    `;
    importantFields.forEach(f => {
      detailsHtml += `
            <div style="background:rgba(255,255,255,0.05); padding:12px 16px; border-radius:8px; border-left:3px solid var(--accent-primary);">
              <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">${f.header}</div>
              <div style="font-size:15px; color:white; font-weight:500;">${f.value}</div>
            </div>
      `;
    });
    detailsHtml += `</div></div>`;
  }

  // Diğer Form Yanıtları
  if (otherFields.length > 0) {
    detailsHtml += `
        <h3 style="margin:16px 0 0 0; font-size:16px; color:var(--text-muted);">Form Yanıtları</h3>
        <div style="display:flex; flex-direction:column; gap:12px;">
    `;
    otherFields.forEach(f => {
      detailsHtml += `
          <div style="background:var(--bg-hover); padding:12px 16px; border-radius:8px;">
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px;">${f.header}</div>
            <div style="font-size:15px; color:white;">${f.value}</div>
          </div>
      `;
    });
    detailsHtml += `</div>`;
  }

  // Meta Reklam Bilgileri (açılır menü)
  if (metaFields.length > 0) {
    detailsHtml += `
        <details style="margin-top:8px; background:var(--card-bg); border:1px solid var(--border-color); border-radius:10px; overflow:hidden;">
          <summary style="padding:12px 16px; cursor:pointer; font-size:14px; font-weight:600; color:var(--text-muted); display:flex; align-items:center; gap:8px; user-select:none;">
            📊 Meta Reklam Bilgileri <span style="font-size:11px; font-weight:400; opacity:0.6;">(${metaFields.length} alan)</span>
          </summary>
          <div style="padding:4px 16px 16px 16px; display:flex; flex-direction:column; gap:8px;">
    `;
    metaFields.forEach(f => {
      detailsHtml += `
            <div style="background:var(--bg-hover); padding:10px 14px; border-radius:8px;">
              <div style="font-size:10px; color:var(--text-muted); margin-bottom:2px; text-transform:uppercase; letter-spacing:0.5px;">${f.header}</div>
              <div style="font-size:13px; color:white; word-break:break-all;">${f.value}</div>
            </div>
      `;
    });
    detailsHtml += `</div></details>`;
  }

  detailsHtml += '</div>'; // Sol panel sonu

  // SAĞ PANEL: Pipeline + Etiketler + Notlar (DB + Sheets entegre)
  const cleanPhone = primaryPhone || (phoneVal || '').replace(/\D/g, '');
  
  // Pipeline → Sheets eşleştirme
  // 🎯 Birleşik Pipeline (pipeline-config.js'den)
  
  // Mevcut Sheets durumundan aktif pipeline'ı belirle
  const currentSheetStatus = statusColIndex > -1 ? (row[statusColIndex] || '') : '';
  const initialStage = SHEETS_TO_STAGE[currentSheetStatus] || 'new';

  let editHtml = `
    <!-- SAĞ PANEL -->
    <div>
      <div style="position:sticky; top:24px; display:flex; flex-direction:column; gap:16px;">
        
        <!-- 🎯 Pipeline Durumu (DB + Sheets Entegre) -->
        <div style="background:var(--card-bg); border:1px solid var(--accent-primary); border-radius:12px; padding:20px; box-shadow:0 8px 24px rgba(10,132,255,0.1);">
          <h3 style="margin:0 0 4px 0; font-size:16px; color:var(--accent-primary); display:flex; align-items:center; gap:8px;">
            🎯 Lead Durumu
          </h3>
          <p style="margin:0 0 14px 0; font-size:11px; color:var(--text-muted);">DB + Google Sheets'e anlık yansır</p>
          <div id="fd-pipeline-stages" style="display:flex; flex-direction:column; gap:6px;">
            ${Object.entries(PIPELINE_STAGES).map(([stage, cfg]) => {
              const isActive = stage === initialStage;
              const activeStyle = isActive ? `background:${cfg.color}22; border-color:${cfg.color}; font-weight:700;` : '';
              return `<button class="fd-stage-btn" data-stage="${stage}" onclick="setLeadPipelineStage('${cleanPhone}', '${nameVal.replace(/'/g, "\\'")}', '${stage}', this, ${statusColIndex}, ${rowIndex})" style="display:flex; align-items:center; gap:8px; width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:white; cursor:pointer; font-size:13px; font-weight:500; transition:all 0.2s; ${activeStyle}">
                <span style="width:10px; height:10px; border-radius:50%; background:${cfg.color}; flex-shrink:0;"></span>
                ${cfg.emoji} ${cfg.label}
              </button>`;
            }).join('')}
          </div>
          <div id="fd-pipeline-info" style="margin-top:12px; font-size:11px; color:var(--text-muted); text-align:center;">
            ${statusColIndex > -1 ? `Sheets durumu: <strong>${currentSheetStatus || 'Boş'}</strong>` : 'Sheets sütunu bulunamadı'}
          </div>
        </div>


        <!-- 🤖 Bot Durumu (Sadece bilgi — kontrol inbox'ta) -->
        <div id="fd-bot-status-card" style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:12px; padding:16px;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <span id="fd-bot-indicator" style="width:10px; height:10px; border-radius:50%; background:#6b7280;"></span>
            <span id="fd-bot-label" style="font-size:13px; font-weight:600; color:var(--text-muted);">Yükleniyor...</span>
          </div>
          <div id="fd-bot-phase" style="font-size:11px; color:var(--text-muted);"></div>
        </div>
        <!-- 🏷️ CRM Etiketler (DB Bağlantılı) -->
        <div style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:12px; padding:20px;">
          <h3 style="margin:0 0 12px 0; font-size:14px; color:white; display:flex; align-items:center; gap:8px;">
            🏷️ CRM Etiketler
          </h3>
          <div id="fd-crm-tags" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; min-height:28px;"></div>
          <select id="fd-add-tag" onchange="addLeadCRMTag('${cleanPhone}', '${nameVal.replace(/'/g, "\\'")}', this.value)" style="width:100%; padding:8px 12px; background:var(--bg-hover); border:1px solid var(--border-color); border-radius:8px; color:var(--text-muted); font-size:12px; cursor:pointer;">
            <option value="">+ Etiket Ekle</option>
          </select>
        </div>

        <!-- 📝 Geri Dönüş / Notlar -->
        <div style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:12px; padding:20px;">
          <h3 style="margin:0 0 12px 0; font-size:14px; color:white;">📝 Geri Dönüş / Notlar</h3>
  `;
  
  if (notesColIndex > -1) {
    const currentNotes = row[notesColIndex] || '';
    editHtml += `
          <textarea style="width:100%; padding:10px; background:var(--bg-hover); border:1px solid var(--border-color); border-radius:8px; color:white; font-size:13px; resize:vertical; min-height:100px;" onblur="updateSheetCell(${rowIndex}, ${notesColIndex}, this.value)" placeholder="Hastaya yapılan geri dönüş notunu buraya yazın...">${String(currentNotes).replace(/"/g, '&quot;')}</textarea>
          <div style="margin-top:6px; font-size:10px; color:var(--text-muted); text-align:center;">✓ Google Sheets'e anlık kaydedilir</div>
    `;
  } else {
    editHtml += `<div style="font-size:12px; color:var(--text-muted);">Sheets'te "Geri Dönüş" veya "Notlar" sütunu bulunamadı.</div>`;
  }

  editHtml += `
        </div>

      </div>
    </div>
  </div>`;

  document.getElementById('fd-content').style.maxWidth = '1100px';
  document.getElementById('fd-content').innerHTML = detailsHtml + editHtml;
  
  // Görünümleri değiştir
  if (window.innerWidth <= 768) {
    navigateMobileFormView('detail');
  } else {
    document.getElementById('page-form-management').style.display = 'none';
    document.getElementById('page-form-detail').style.display = 'flex';
  }

  // Async: DB'den CRM verisini yükle (etiketler vb.)
  loadFormDetailCRM(cleanPhone);
}

// Form detay CRM verisini DB'den yükle
async function loadFormDetailCRM(phone) {
  if (!phone) return;
  try {
    const pData = await api('get-patient&phone=' + phone);
    
    // Pipeline durumunu DB'den kontrol et (her zaman güncelle, sadece 'new' değilse değil)
    const effectiveStage = pData.lead_stage || 'new';
    document.querySelectorAll('.fd-stage-btn').forEach(btn => {
      const stage = btn.dataset.stage;
      const sCfg = PIPELINE_STAGES[stage] || PIPELINE_STAGES.new;
      if (stage === effectiveStage) {
        btn.style.background = sCfg.color + '22';
        btn.style.borderColor = sCfg.color;
        btn.style.fontWeight = '700';
      } else {
        btn.style.background = 'var(--bg-hover)';
        btn.style.borderColor = 'var(--border-color)';
        btn.style.fontWeight = '500';
      }
    });
    const infoEl = document.getElementById('fd-pipeline-info');
    const dbCfg = PIPELINE_STAGES[effectiveStage] || { emoji: '❓', label: effectiveStage };
    if (infoEl) infoEl.innerHTML = `DB durumu: <strong>${dbCfg.emoji} ${dbCfg.label}</strong>`;
    
    // 🤖 Bot Durumu güncelle
    const isHuman = pData.status === 'human';
    const isActive = pData.status === 'active';
    const botIndicator = document.getElementById('fd-bot-indicator');
    const botLabel = document.getElementById('fd-bot-label');
    const botPhase = document.getElementById('fd-bot-phase');
    
    if (botIndicator) {
      if (isHuman) {
        botIndicator.style.background = '#FF9F0A';
        botLabel.textContent = '👤 Manuel Kontrol';
        botLabel.style.color = '#FF9F0A';
      } else if (isActive) {
        botIndicator.style.background = '#30D158';
        botIndicator.style.boxShadow = '0 0 12px rgba(48,209,88,0.6)';
        botLabel.textContent = '🤖 Bot Aktif';
        botLabel.style.color = '#30D158';
      }
    }
    
    if (botPhase) {
      const phaseLabels = {
        greeting: '📍 Karşılama — Şikayeti dinliyor',
        discovery: '📍 Analiz — Tetkik/MR istiyor',
        trust: '📍 İkna — Güven oluşturuyor',
        handover: '⚠️ Devir — Randevu bekliyor!'
      };
      botPhase.textContent = phaseLabels[pData.phase] || '📍 Başlangıç';
      botPhase.style.color = pData.phase === 'handover' ? '#FF453A' : 'var(--text-muted)';
      botPhase.style.fontWeight = pData.phase === 'handover' ? '600' : '400';
    }
    
    // 🔄 "Bota Devret" butonunu DB durumuna göre güncelle (sayfa yenilendiğinde de hatırla)
    if (isActive || isHuman) {
      const outboundBtns = document.querySelectorAll('[onclick*="triggerSingleOutbound"]');
      outboundBtns.forEach(btn => {
        btn.textContent = '✅ Bot Başlatıldı';
        btn.style.background = 'rgba(48,209,88,0.15)';
        btn.style.color = '#30D158';
        btn.style.border = '1px solid rgba(48,209,88,0.3)';
        btn.style.cursor = 'default';
        btn.onclick = null;
      });
    }
    
    // CRM etiketleri yükle
    let currentTags = [];
    try { currentTags = JSON.parse(pData.tags || '[]'); } catch(e) {}
    renderFormDetailTags(phone, pData.patient_name || '', currentTags);
    
  } catch(e) {
    console.error('CRM yükleme hatası:', e);
  }
}

/* Bot kontrol fonksiyonları kaldırıldı — kontrol inbox sohbet başlığında */

// Pipeline durumu değiştir — DB + Sheets'e birlikte yaz
async function setLeadPipelineStage(phone, name, stage, btnEl, sheetsStatusCol, sheetsRowIndex) {
  if (!phone) return toast('Telefon numarası bulunamadı', 'error');
  
  const cfg = PIPELINE_STAGES[stage] || PIPELINE_STAGES.new;
  
  // UI: buton vurgulama
  document.querySelectorAll('.fd-stage-btn').forEach(btn => {
    btn.style.background = 'var(--bg-hover)';
    btn.style.borderColor = 'var(--border-color)';
    btn.style.fontWeight = '500';
  });
  btnEl.style.background = cfg.color + '22';
  btnEl.style.borderColor = cfg.color;
  btnEl.style.fontWeight = '700';

  const infoEl = document.getElementById('fd-pipeline-info');
  if (infoEl) infoEl.innerHTML = '⏳ Kaydediliyor...';
  
  try {
    // 1. DB'ye kaydet → backend otomatik Google Sheets'e yazar
    await api('update-patient', 'POST', { phone, patient_name: name || null, lead_stage: stage });
    
    // 2. Tüm view'ları senkronize et (inbox, form listesi, label'lar, cache, lokal sheets)
    syncStageToAllViews(phone, stage);
    
    if (infoEl) {
      infoEl.innerHTML = `✅ <strong>${cfg.emoji} ${cfg.label}</strong> — DB + Sheets kaydedildi`;
      if (stage === 'appointed') infoEl.innerHTML += '<br>🗓️ Randevu Talepleri paneline eklendi';
    }
    toast(`${cfg.emoji} ${cfg.label}`, 'success', { phone });
  } catch(e) {
    toast('Kayıt hatası', 'error', { phone });
    if (infoEl) infoEl.innerHTML = '❌ Kayıt hatası';
  }
}

// Arka plandaki satır arayüzünü anlık güncellemek için yardımcı fonksiyon
function refreshLeadRowUI(phone) {
  const cleanP = (phone || '').replace(/\D/g, '');
  const last10 = cleanP.length > 10 ? cleanP.slice(-10) : cleanP;
  
  // Tüm eşleşen cache girişlerini temizle (format ne olursa olsun)
  if (window._enrichCache) {
    Object.keys(window._enrichCache).forEach(key => {
      const keyClean = key.replace(/\D/g, '');
      if (keyClean.endsWith(last10) || last10.endsWith(keyClean.slice(-10))) {
        delete window._enrichCache[key];
      }
    });
  }
  if (!window._sheetRows || !window._sheetHeaders) return;
  
  const phoneCol = window._sheetHeaders.findIndex(h => {
    const l = h.toLowerCase().replace(/[_\s]+/g, '');
    return l === 'phonenumber' || l === 'phone' || l === 'telefon' || l === 'tel' || l === 'gsm' || l === 'cep';
  });
  if (phoneCol === -1) return;
  
  const targetRows = window._sheetRows.filter(row => {
    const rawP = (row[phoneCol] || '').replace(/\D/g, '');
    return rawP.endsWith(last10) || last10.endsWith(rawP.slice(-10));
  });
  
  if (targetRows.length > 0 && typeof enrichLeadCards === 'function') {
    enrichLeadCards(targetRows, phoneCol);
  }
}

function renderFormDetailTags(phone, name, selectedTags) {
  const container = document.getElementById('fd-crm-tags');
  const select = document.getElementById('fd-add-tag');
  if (!container || !select) return;
  
  container.innerHTML = selectedTags.map(t => {
    const tc = getTagColor(t);
    return `<div onclick="removeLeadCRMTag('${phone}', '${name.replace(/'/g, "\\'")}', '${t.replace(/'/g, "\\'")}')" style="background:${tc.bg}; color:${tc.text}; padding:4px 10px; border-radius:12px; font-size:12px; font-weight:500; cursor:pointer; display:flex; align-items:center; gap:4px;">
      ${t} <span style="opacity:0.6;">✕</span>
    </div>`;
  }).join('') || '<div style="font-size:11px; color:var(--text-muted);">Henüz etiket yok</div>';
  
  const available = allTags.filter(t => !selectedTags.includes(t.name));
  select.innerHTML = '<option value="">+ Etiket Ekle</option>' + available.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
}

// Etiket ekle
async function addLeadCRMTag(phone, name, tagName) {
  if (!tagName || !phone) return;
  const pData = await api('get-patient&phone=' + phone);
  let tags = [];
  try { tags = JSON.parse(pData.tags || '[]'); } catch(e) {}
  if (tags.includes(tagName)) return;
  
  tags.push(tagName);
  await api('update-patient', 'POST', {
    phone, patient_name: name || pData.patient_name || null,
    tags: JSON.stringify(tags), lead_stage: pData.lead_stage || 'new'
  });
  renderFormDetailTags(phone, name || pData.patient_name || '', tags);
  toast(`🏷️ "${tagName}" eklendi`, 'success', { phone: phone });
  
  if (typeof refreshLeadRowUI === 'function') refreshLeadRowUI(phone);
  syncTagsToInboxCache(phone, tags);
}

// Etiket kaldır
async function removeLeadCRMTag(phone, name, tagName) {
  const pData = await api('get-patient&phone=' + phone);
  let tags = [];
  try { tags = JSON.parse(pData.tags || '[]'); } catch(e) {}
  tags = tags.filter(t => t !== tagName);
  
  await api('update-patient', 'POST', {
    phone, patient_name: name || pData.patient_name || null,
    tags: JSON.stringify(tags), lead_stage: pData.lead_stage || 'new'
  });
  renderFormDetailTags(phone, name || pData.patient_name || '', tags);
  toast(`🗑️ "${tagName}" kaldırıldı`, 'info', { phone: phone });
  
  if (typeof refreshLeadRowUI === 'function') refreshLeadRowUI(phone);
  syncTagsToInboxCache(phone, tags);
}

// Inbox cache'inde tag bilgisini güncelle
function syncTagsToInboxCache(phone, tags) {
  if (typeof cachedConversations === 'undefined') return;
  const cleanP = phone.replace(/\D/g, '');
  const idx = cachedConversations.findIndex(c => {
    const cp = (c.phone_number || '').replace(/\D/g, '');
    return cp === cleanP || cp.endsWith(cleanP.slice(-10)) || cleanP.endsWith(cp.slice(-10));
  });
  if (idx > -1) {
    cachedConversations[idx].tags = JSON.stringify(tags);
  }
}

function editLeadStatusOptions() {
  let storedOptions = localStorage.getItem('leadStatusOptions');
  let currentOptions = storedOptions ? JSON.parse(storedOptions) : ['', 'SİSTEME ALINDI ✅', 'CREATED', 'İletişime Geçildi', 'Cevap Verdi', 'İlgili', 'Randevu Aldı', 'Geldi', 'Tedavi Oldu', 'Soğuk'];
  
  const userInput = prompt("Lead süreçlerini virgülle ayırarak giriniz:\n(Örn: Yeni, Arandı, Ulaşılamadı, İlgilenmiyor, Randevu Alındı)", currentOptions.filter(x => x).join(', '));
  
  if (userInput !== null) {
    const newOptions = ['', ...userInput.split(',').map(s => s.trim()).filter(s => s)];
    localStorage.setItem('leadStatusOptions', JSON.stringify(newOptions));
    toast('Süreç seçenekleri güncellendi.');
    // Yeniden render etmek için sayfayı yalandan refresh edebiliriz
    goBackToForms();
  }
}

async function triggerSingleOutbound(phone, name) {
  if (!phone) return toast('Geçerli bir telefon numarası yok', 'error');
  if (!confirm(`${name || phone} adlı hastaya otomatik açılış şablonu mesajı gönderilecek. Emin misiniz?`)) return;

  try {
    toast('Mesaj gönderiliyor...', 'info');
    
    // Form satır verisini topla (brain.js'e aktarmak için)
    let formData = {};
    let campaignName = '';
    let cityVal = '';
    let emailVal = '';
    if (window._sheetHeaders && window._currentLeadRowData) {
      window._sheetHeaders.forEach((header, idx) => {
        if (window._currentLeadRowData[idx]) {
          formData[header] = window._currentLeadRowData[idx];
        }
        const h = header.toLowerCase();
        if (h.includes('campaign') || h.includes('kampanya')) campaignName = window._currentLeadRowData[idx] || '';
        if (h.includes('city') || h.includes('şehir') || h.includes('sehir') || h.includes('ülke') || h.includes('country')) cityVal = window._currentLeadRowData[idx] || '';
        if (h.includes('email') || h.includes('eposta')) emailVal = window._currentLeadRowData[idx] || '';
      });
    }
    
    const resp = await fetch('/api/bulk-outbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        leads: [{ phone, name, formData, campaignName, city: cityVal, email: emailVal }],
        sheetContext: { sheetName: window._activeSheet }
      })
    });
    const data = await resp.json();
    
    if (data.success && data.results.success > 0) {
      toast('✅ Mesaj başarıyla gönderildi ve bot başlatıldı!');
      
      // 1. Bot Durumu → Yeşil / Aktif
      const botIndicator = document.getElementById('fd-bot-indicator');
      const botLabel = document.getElementById('fd-bot-label');
      const botPhase = document.getElementById('fd-bot-phase');
      if (botIndicator && botLabel) {
        botIndicator.style.background = '#30D158';
        botIndicator.style.boxShadow = '0 0 12px rgba(48,209,88,0.6)';
        botLabel.textContent = '🤖 Bot Aktif';
        botLabel.style.color = '#30D158';
      }
      if (botPhase) {
        botPhase.textContent = '📍 Karşılama — Şikayeti dinliyor';
        botPhase.style.color = 'var(--text-muted)';
      }
      
      // 2. "Bota Devret" butonunu gizle, yerine durum göster
      const outboundBtns = document.querySelectorAll('[onclick*="triggerSingleOutbound"]');
      outboundBtns.forEach(btn => {
        btn.textContent = '✅ Bot Başlatıldı';
        btn.style.background = 'rgba(48,209,88,0.15)';
        btn.style.color = '#30D158';
        btn.style.border = '1px solid rgba(48,209,88,0.3)';
        btn.style.cursor = 'default';
        btn.onclick = null;
      });
      
      // 3. Lead Durumunu "İlk Temas"a çek (UI güncelle)
      const contactedBtn = document.querySelector('.fd-stage-btn[data-stage="contacted"]');
      if (contactedBtn) {
        document.querySelectorAll('.fd-stage-btn').forEach(btn => {
          btn.style.background = 'var(--bg-hover)';
          btn.style.borderColor = 'var(--border-color)';
          btn.style.fontWeight = '500';
        });
        contactedBtn.style.background = '#0A84FF22';
        contactedBtn.style.borderColor = '#0A84FF';
        contactedBtn.style.fontWeight = '700';
      }
      const infoEl = document.getElementById('fd-pipeline-info');
      if (infoEl) infoEl.innerHTML = `✅ <strong>📞 İlk Temas</strong> — Bot mesaj gönderdi`;
      
      // 4. DB'ye de "contacted" olarak kaydet
      try {
        const cleanPhone = phone.replace(/\D/g, '');
        await api('update-patient', 'POST', {
          phone: cleanPhone,
          patient_name: name || null,
          lead_stage: 'contacted'
        });
      } catch(e) { console.warn('Lead stage update failed:', e); }
      
    } else {
      const errMsg = data.results?.details?.[0]?.error || 'Bilinmeyen hata';
      toast('❌ Mesaj gönderilemedi: ' + errMsg, 'error');
    }
  } catch (error) {
    toast('Sunucu hatası', 'error');
  }
}
function goBackToForms() {
  if (window.innerWidth <= 768) {
    navigateMobileFormView('list');
  } else {
    document.getElementById('page-form-detail').style.display = 'none';
    document.getElementById('page-form-management').style.display = 'flex';
  }
  // Listeyi sessizce yenile ki yapılan editler karta yansısın
  if (window._activeSheet) loadSheetData(window._activeSheet);
}



async function triggerBulkOutbound() {
  if (!window._activeSheet || !window._sheetHeaders || !window._sheetRows) return toast('Önce bir liste yükleyin', 'error');
  
  const headers = window._sheetHeaders.map(h => h.toLowerCase());
  let phoneCol = headers.findIndex(h => h.includes('telefon') || h.includes('phone') || h === 'tel');
  let nameCol = headers.findIndex(h => h.includes('ad') || h.includes('isim') || h.includes('name'));
  let statusCol = headers.findIndex(h => h.includes('durum') || h.includes('status'));
  
  if (phoneCol === -1) return toast('Telefon sütunu bulunamadı', 'error');
  
  const leadsToProcess = [];
  window._sheetRows.forEach((row, i) => {
    const phone = row[phoneCol];
    const name = nameCol > -1 ? row[nameCol] : '';
    const status = statusCol > -1 ? (row[statusCol] || '') : '';
    
    // Eğer telefon var ve durum boşsa (Sisteme alınmadıysa)
    if (phone && (!status || (!status.includes('SİSTEME ALINDI') && !status.includes('ALINDI')))) {
      leadsToProcess.push({ rowIndex: i, phone, name, statusColIndex: statusCol > -1 ? statusCol + 1 : headers.length + 1 });
    }
  });

  if (leadsToProcess.length === 0) return toast('İşlenecek yeni lead bulunamadı!', 'info');
  
  if (!confirm(`${leadsToProcess.length} adet yeni lead tespit edildi. Hepsine otomatik WhatsApp açılış mesajı gönderilecek. Onaylıyor musunuz?`)) return;

  toast(`🚀 ${leadsToProcess.length} lead işleniyor... Lütfen bekleyin.`, 'info');
  
  try {
    const res = await fetch('/api/bulk-outbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetName: window._activeSheet,
        leads: leadsToProcess,
        templateName: 'lead_greeting' // Default meta template
      })
    });
    
    const data = await res.json();
    if (data.success) {
      toast(`✅ İşlem tamam! Başarılı: ${data.results.success}, Hatalı: ${data.results.failed}`);
      // Tabloyu güncelle
      loadSheetData(window._activeSheet);
    } else {
      toast('Hata oluştu: ' + data.error, 'error');
    }
  } catch (err) {
    toast('Bağlantı hatası', 'error');
  }
}

