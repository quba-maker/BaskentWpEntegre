/* KANBAN BOARD — Kaldırıldı, pipeline filtreleri inbox'a taşındı */
function loadKanban() { /* noop — artık pipeline filtreleri inbox'ta */ }


async function loadConversations() {
  const list = await api('conversations'); if(!list) return;
  allTags = await api('tags') || [];
  cachedConversations = list;
  renderConversationList();
}

let lastChatLength = 0; // SWR polling için uzunluk takibi

async function loadChat(phone, channel) {
  currentPhone = phone; currentChannel = channel;
  
  // Highlight active
  document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
  const activeEl = Array.from(document.querySelectorAll('.contact-item')).find(el => el.innerHTML.includes(phone));
  if(activeEl) activeEl.classList.add('active');

  // Trigger mobile navigation to chat view
  if (window.innerWidth <= 768) {
    navigateMobileView('chat');
    document.getElementById('btn-mobile-crm').style.display = 'inline-flex';
  }

  // Load patient data for CRM and Status
  const pData = await api('get-patient&phone='+phone);
  const hasName = pData.patient_name && pData.patient_name !== phone;
  document.getElementById('chat-title').textContent = pData.patient_name || phone;
  const country = getCountry(phone);
  const countryInfo = country ? `${country.flag} ${country.name} · ` : '';
  document.getElementById('chat-phone').innerHTML = hasName ? `${countryInfo}${phone}` : (country ? `${country.flag} ${country.name}` : '');
  document.getElementById('chat-phone').style.display = (hasName || country) ? 'inline' : 'none';
  document.getElementById('chat-channel-badge').innerHTML = getChannelBadge(currentChannel);
  document.getElementById('chat-channel-badge').style.display = 'inline-flex';
  
  // Handover controls
  document.getElementById('chat-actions').style.display = 'flex';
  const isHuman = pData.status === 'human';
  document.getElementById('btn-status-bot').className = `handover-btn ${!isHuman ? 'active-bot' : ''}`;
  document.getElementById('btn-status-human').className = `handover-btn ${isHuman ? 'active-human' : ''}`;
  
  document.getElementById('chat-input-area').style.display = 'flex';
  
  // CRM setup — hide on mobile
  const isMobile = window.innerWidth <= 768;
  document.getElementById('crm-panel').style.display = isMobile ? 'none' : 'flex';
  document.getElementById('crm-name').value = pData.patient_name || '';
  document.getElementById('crm-notes').value = pData.notes || '';
  
  // 📊 Lead Score Gösterimi
  const scoreEl = document.getElementById('crm-score');
  if (scoreEl) {
    const s = pData.lead_score || 0;
    const clr = s >= 80 ? '#30d158' : s >= 60 ? '#34c759' : s >= 30 ? '#ffd60a' : '#ff453a';
    scoreEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span style="font-size:11px;color:var(--text-muted)">Skor</span>
      <div style="flex:1;height:6px;background:var(--bg-tertiary);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${Math.min(s,100)}%;background:${clr};border-radius:3px;transition:width 0.5s;"></div>
      </div>
      <span style="font-size:12px;font-weight:700;color:${clr}">${s}</span>
    </div>`;
  }
  
  // 🏥 Bölüm: Formdan gelen department'i otomatik yerleştir
  const deptSelect = document.getElementById('crm-department');
  const deptAutoEl = document.getElementById('crm-dept-auto');
  const deptAutoVal = document.getElementById('crm-dept-auto-val');
  const dept = pData.department || '';
  deptSelect.value = dept;
  // Eğer formdan gelen bir department varsa, otomatik etiketi göster
  if (dept && pData.has_lead) {
    deptAutoEl.style.display = 'block';
    deptAutoVal.textContent = dept;
  } else {
    deptAutoEl.style.display = 'none';
  }
  
  // 🎯 Süreç Durumu: Birleşik pipeline
  const stageSelect = document.getElementById('crm-stage');
  const effectiveStage = pData.lead_stage || (pData.has_lead ? 'new' : 'new');
  // Fallback: eski 'waiting' → 'new', 'responded' → 'discovery'
  const stageMap = { waiting: 'new', responded: 'discovery', appointment_request: 'hot_lead' };
  stageSelect.value = stageMap[effectiveStage] || effectiveStage;

  // Tags are now handled system-wide

  // Lead Form bilgilerini doldur
  const leadInfo = document.getElementById('crm-lead-info');
  if (pData.has_lead) {
    leadInfo.style.display = 'block';
    document.getElementById('crm-lead-form').textContent = pData.lead_form_name || '—';
    document.getElementById('crm-lead-city').textContent = pData.lead_city || '—';
    document.getElementById('crm-lead-email').textContent = pData.lead_email || '—';
    document.getElementById('crm-lead-date').textContent = pData.lead_date ? new Date(pData.lead_date).toLocaleDateString('tr-TR') : '—';
    const stageCfg = PIPELINE_STAGES[pData.lead_stage] || { emoji: '❓', label: pData.lead_stage || '—' };
    document.getElementById('crm-lead-stage').textContent = `${stageCfg.emoji} ${stageCfg.label}`;
    document.getElementById('crm-lead-score').innerHTML = pData.lead_score ? `<b>${pData.lead_score}</b> / 100` : '—';
    // Adı lead'den geliyorsa otomatik doldur
    if (pData.patient_name && !document.getElementById('crm-name').value) {
      document.getElementById('crm-name').value = pData.patient_name;
    }
  } else {
    leadInfo.style.display = 'none';
  }

  // Load Messages
  const data = await api('conversation-detail&phone='+phone);
  if(!data) return;
  const msgs = data.messages || data; // Geriye uyumluluk (eğer eski format gelirse)
  const chatEl = document.getElementById('chat-messages');
  
  let lastDateLabel = '';
  
  chatEl.innerHTML = msgs.map(m => {
    const msgDate = new Date(m.created_at);
    const now = new Date();
    
    // Tarih etiketi hesaplama
    let dateLabel = '';
    const isToday = msgDate.toDateString() === now.toDateString();
    
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = msgDate.toDateString() === yesterday.toDateString();
    
    if (isToday) {
      dateLabel = 'Bugün';
    } else if (isYesterday) {
      dateLabel = 'Dün';
    } else if (now.getTime() - msgDate.getTime() < 7 * 24 * 60 * 60 * 1000) {
      const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
      dateLabel = days[msgDate.getDay()];
    } else {
      const isCurrentYear = msgDate.getFullYear() === now.getFullYear();
      dateLabel = msgDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: isCurrentYear ? undefined : 'numeric' });
    }
    
    let separatorHtml = '';
    if (dateLabel !== lastDateLabel) {
      separatorHtml = `<div style="display:flex; justify-content:center; margin: 16px 0 8px 0; width:100%;"><span style="background:rgba(255,255,255,0.06); padding:4px 12px; border-radius:12px; font-size:11px; font-weight:600; color:var(--text-muted); backdrop-filter:blur(10px); box-shadow:0 2px 4px rgba(0,0,0,0.1); border:1px solid rgba(255,255,255,0.05);">${dateLabel}</span></div>`;
      lastDateLabel = dateLabel;
    }

    const isOut = m.direction === 'out';
    const isBot = m.model_used && m.model_used !== 'panel' && m.model_used !== 'toplu';
    const cls = `message-bubble ${isOut ? 'out' : 'in'} ${isOut && isBot ? 'bot-reply' : ''}`;
    const senderLabel = isOut ? (isBot ? '🤖 Bot' : '👤 Sen') : '📩 Hasta';
    const info = `<div class="msg-info">${senderLabel} · ${msgDate.toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit'})} ${isBot ? '<span class="bot-indicator">' + m.model_used + '</span>' : ''}</div>`;
    
    // Medya içerik kontrolü — content'ten media_id parse et
    let content = escapeHtml(m.content || '');
    const mediaMatch = content.match(/\|media_id:([a-zA-Z0-9_]+)\]/);
    if (mediaMatch) {
      const mediaId = mediaMatch[1];
      const isImage = content.includes('📷') || content.includes('📸') || content.includes('Görüntü gönderildi');
      const isDoc = content.includes('📄') || content.includes('Belge gönderildi');
      
      // media_id kısmını içerikten temizle ve bracket text'i ([...]) kaldır
      const cleanContent = content.replace(/\|media_id:[a-zA-Z0-9_]+\]/, ']');
      const textWithoutMediaBracket = cleanContent.replace(/\[[^\]]*\]\s*/, '').trim();
      
      if (isImage) {
        content = `<img src="/api/panel?action=media&id=${mediaId}&token=${AUTH_TOKEN}" style="max-width:min(280px,100%);border-radius:12px;margin-bottom:6px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);" onclick="window.open('/api/panel?action=media&id=${mediaId}&token=${AUTH_TOKEN}','_blank')" loading="lazy"><br><span style="font-size:12px;opacity:0.8;">${textWithoutMediaBracket}</span>`;
      } else if (isDoc) {
        content = `📎 <a href="/api/panel?action=media&id=${mediaId}&token=${AUTH_TOKEN}" target="_blank" style="color:#60a5fa;text-decoration:underline;font-weight:500;">${textWithoutMediaBracket || 'Belgeyi İndir'}</a>`;
      }
    } else if (m.media_url) {
      // Eski format desteği (media_url alanı varsa)
      if (m.media_type === 'image') content = `<img src="${m.media_url}" style="max-width:min(240px,100%);border-radius:8px;margin-bottom:4px;"><br>${escapeHtml(m.content||'')}`;
      else content = `📎 <a href="${m.media_url}" target="_blank" style="color:inherit;text-decoration:underline">${escapeHtml(m.content||'Dosya')}</a>`;
    }
    return separatorHtml + `<div class="${cls}">${content}${info}</div>`;
  }).join('');
  chatEl.scrollTop = chatEl.scrollHeight;
  lastChatLength = msgs.length; // Başlangıç mesaj sayısını kaydet
  
  // Form Geçmişi — CRM panelinde göster (form cevapları dahil)
  const formHistory = data.forms || [];
  const formBox = document.getElementById('crm-form-history');
  const formWrapper = document.getElementById('crm-form-history-wrapper');
  if (formBox && formWrapper) {
    if (formHistory.length > 0) {
      formBox.innerHTML = formHistory.map((f, fi) => {
        const dt = new Date(f.created_at).toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'});
        let tags = []; try { tags = JSON.parse(f.tags || '[]'); } catch(e) {}
        
        // Form cevaplarını parse et ve temizle
        let formAnswersHtml = '';
        try {
          const rawData = typeof f.raw_data === 'string' ? JSON.parse(f.raw_data || '{}') : (f.raw_data || {});
          // İsim ve telefon gibi gereksiz veya halihazırda görünen bilgileri gizle
          const skipKeys = ['id', 'leadgen_id', 'form_id', 'ad_id', 'adset_id', 'campaign_id', 'platform', 'is_organic', 'created_time', 'phone_number_id', 'full_name', 'phone_number'];
          const entries = Object.entries(rawData).filter(([key]) => !skipKeys.includes(key.toLowerCase()));
          if (entries.length > 0) {
            formAnswersHtml = `<div id="form-answers-${fi}" style="display:none; margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.06);">
              <div style="display:flex; flex-direction:column; gap:6px;">
              ${entries.map(([key, val]) => {
                const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                const cleanVal = String(val || '').replace(/_/g, ' ');
                return `<div style="background:rgba(255,255,255,0.03); padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.04);">
                  <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; font-weight:500;">${label}</div>
                  <div style="font-size:13px; color:white; font-weight:400; line-height:1.5; word-wrap:break-word; overflow-wrap:break-word; white-space:pre-wrap;">${cleanVal}</div>
                </div>`;
              }).join('')}
              </div>
            </div>`;
          }
        } catch(e) {}
        
        const hasAnswers = formAnswersHtml !== '';
        
        // Form adını kısalt (Eğer çok uzunsa çirkin görünmemesi için)
        let displayName = f.form_name || 'Genel Kampanya Formu';
        if (displayName.length > 35) displayName = displayName.substring(0, 32) + '...';

        return `<div style="background:var(--bg-card); border:1px solid rgba(255,255,255,0.1); border-radius:8px; margin-bottom:8px; padding:12px; transition:border-color 0.2s;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; cursor:${hasAnswers ? 'pointer' : 'default'};" ${hasAnswers ? `onclick="const el=document.getElementById('form-answers-${fi}'); const icon=document.getElementById('form-icon-${fi}'); if(el.style.display==='none'){el.style.display='block';icon.style.transform='rotate(90deg)';}else{el.style.display='none';icon.style.transform='rotate(0deg)';}"` : ''}>
            
            <div style="flex:1;">
              <div style="font-weight:600; font-size:13px; color:#fff; margin-bottom:6px; display:flex; align-items:center; gap:6px;">
                <i class="fas fa-clipboard-list" style="color:var(--accent-primary)"></i> 
                <span title="${f.form_name || ''}">${displayName}</span>
              </div>
              
              <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                <span style="font-size:11px; color:var(--text-muted); background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px;"><i class="fas fa-calendar-alt" style="margin-right:4px;"></i>${dt}</span>
                ${f.city ? `<span style="font-size:11px; color:var(--text-muted); background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px;"><i class="fas fa-map-marker-alt" style="margin-right:4px;"></i>${f.city}</span>` : ''}
                ${tags.map(t => `<span style="font-size:11px; color:var(--accent-primary); background:rgba(10,132,255,0.1); padding:2px 6px; border-radius:4px;">${t}</span>`).join('')}
              </div>
            </div>

            ${hasAnswers ? `<div style="color:var(--text-muted); font-size:11px; display:flex; align-items:center; gap:4px; padding-top:2px;">
              Yanıtlar <i id="form-icon-${fi}" class="fas fa-chevron-right" style="transition:transform 0.2s; font-size:10px;"></i>
            </div>` : ''}

          </div>
          ${formAnswersHtml}
        </div>`;
      }).join('');
      formWrapper.style.display = 'block';
    } else {
      formBox.innerHTML = '';
      formWrapper.style.display = 'none';
    }
  }
}

function renderCRMTags(selected=[]) {
  const container = document.getElementById('crm-tags');
  container.innerHTML = selected.map(t => 
    `<div class="tag selected" onclick="this.remove()" data-val="${t}" style="--tag-color:#3b82f6">${t} ✕</div>`
  ).join('');

  // Dropdown options (filter out already selected tags and system tags)
  const select = document.getElementById('crm-add-tag');
  const available = allTags.filter(t => !selected.includes(t.name) && !['Gurbetçi', 'Yabancı Turist', 'Yerli', 'Kaybedildi', 'Randevu İstiyor'].includes(t.name));
  
  select.innerHTML = '<option value="">+ Etiket Ekle</option>' + available.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
}

function addCRMTag(val) {
  if (!val) return;
  const container = document.getElementById('crm-tags');
  // Zaten ekli mi kontrol et
  if (Array.from(container.children).some(el => el.dataset.val === val)) return;
  
  container.insertAdjacentHTML('beforeend', `<div class="tag selected" onclick="this.remove()" data-val="${val}" style="--tag-color:#3b82f6">${val} ✕</div>`);
  document.getElementById('crm-add-tag').value = '';
}

