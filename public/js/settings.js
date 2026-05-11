/* AYARLAR & ETİKETLER */
async function loadSettings() {
  const s = await api('settings'); if(!s) return;
  document.getElementById('model-select').value = s.ai_model || 'gemini-2.5-flash-lite';
  allTags = await api('tags') || [];
  document.getElementById('tag-list').innerHTML = allTags.map(t => 
    `<div style="display:flex; justify-content:space-between; padding:12px; background:var(--bg-hover); border-radius:var(--radius-sm);">
      <span style="color:${t.color}; font-weight:600;">${t.name}</span>
      <button class="btn-sm btn-danger" onclick="deleteTag(${t.id})">Sil</button>
    </div>`
  ).join('');
  
  // Kanal toggle durumlarını yükle (varsayılan: WA açık, IG ve Messenger kapalı)
  document.getElementById('toggle-whatsapp').checked = (s.channel_whatsapp_enabled || 'true') === 'true';
  document.getElementById('toggle-instagram').checked = (s.channel_instagram_enabled || 'false') === 'true';
  document.getElementById('toggle-messenger').checked = (s.channel_messenger_enabled || 'false') === 'true';
  
  // Form karşılama mesajlarını yükle
  document.getElementById('form-greeting-tr').value = s.form_greeting_tr || '';
  document.getElementById('form-greeting-en').value = s.form_greeting_en || '';
  
  // Teklif şablonu ayarlarını yükle
  document.getElementById('qt-hospital-name').value = s.qt_hospital_name || '';
  document.getElementById('qt-hospital-subtitle').value = s.qt_hospital_subtitle || '';
  document.getElementById('qt-intro-text').value = s.qt_intro_text || '';
  document.getElementById('qt-footer-note').value = s.qt_footer_note || '';
  document.getElementById('qt-footer-address').value = s.qt_footer_address || '';
  document.getElementById('qt-validity-days').value = s.qt_validity_days || '30';
  document.getElementById('qt-wa-message').value = s.qt_wa_message || '';
}

async function saveModel() {
  const model = document.getElementById('model-select').value;
  await api('settings', 'POST', { key: 'ai_model', value: model });
  toast('Yapay Zeka Modeli güncellendi ✅');
}

async function saveChannelToggle(channel, enabled) {
  const key = `channel_${channel}_enabled`;
  const value = enabled ? 'true' : 'false';
  await api('settings', 'POST', { key, value });
  const labels = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' };
  const emoji = enabled ? '✅' : '⛔';
  toast(`${emoji} ${labels[channel]} botu ${enabled ? 'AKTİF' : 'PASİF'} yapıldı`);
}
async function addTag() {
  await api('tags','POST',{name:document.getElementById('new-tag').value, color:document.getElementById('new-tag-color').value});
  document.getElementById('new-tag').value=''; loadSettings();
}
async function deleteTag(id) { await api('tags&id='+id,'DELETE'); loadSettings(); }

async function saveFormGreetings() {
  const tr = document.getElementById('form-greeting-tr').value;
  const en = document.getElementById('form-greeting-en').value;
  await api('settings','POST',{key:'form_greeting_tr', value: tr});
  await api('settings','POST',{key:'form_greeting_en', value: en});
  toast('Form karşılama mesajları kaydedildi ✅');
}

async function saveQuoteTemplate() {
  const fields = [
    ['qt_hospital_name', 'qt-hospital-name'],
    ['qt_hospital_subtitle', 'qt-hospital-subtitle'],
    ['qt_intro_text', 'qt-intro-text'],
    ['qt_footer_note', 'qt-footer-note'],
    ['qt_footer_address', 'qt-footer-address'],
    ['qt_validity_days', 'qt-validity-days'],
    ['qt_wa_message', 'qt-wa-message']
  ];
  for (const [key, id] of fields) {
    await api('settings', 'POST', { key, value: document.getElementById(id).value });
  }
  toast('Teklif şablonu kaydedildi ✅');
}

let calendarEventsData = [];
let selectedAptId = null;
let aptFilterMode = 'all';

function switchAptTab(tab) {
  document.querySelectorAll('#page-appointments .sheet-tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-apt-' + tab).classList.add('active');
  document.getElementById('apt-view-inbox').style.display = tab === 'inbox' ? 'flex' : 'none';
  document.getElementById('apt-view-calendar').style.display = tab === 'calendar' ? 'block' : 'none';
  if (tab === 'calendar') filterCalendar();
}

function filterAptList(mode) {
  aptFilterMode = mode;
  // Highlight active stat pill
  document.querySelectorAll('.apt-stat-pill').forEach(p => {
    p.style.borderColor = p.dataset.filter === mode ? 'var(--accent-primary)' : 'transparent';
  });
  const titles = {all:'Tüm Talepler',pending:'⏳ Bekleyenler',called:'📞 Görüşülenler',scheduled:'📅 Takvimdekiler',completed:'🏥 Tamamlananlar',lost:'❌ Olumsuzlar'};
  const el = document.getElementById('apt-list-title');
  if (el) el.textContent = titles[mode] || 'Tüm Talepler';
  renderAptList();
}

function renderAptList() {
  let filtered = calendarEventsData;
  if (aptFilterMode !== 'all') {
    if (aptFilterMode === 'scheduled') filtered = calendarEventsData.filter(e => ['scheduled','confirmed'].includes(e.status));
    else if (aptFilterMode === 'completed') filtered = calendarEventsData.filter(e => ['completed'].includes(e.status));
    else if (aptFilterMode === 'lost') filtered = calendarEventsData.filter(e => ['lost','cancelled','noshow'].includes(e.status));
    else filtered = calendarEventsData.filter(e => e.status === aptFilterMode);
  }
  
  const list = document.getElementById('appointment-list');
  if (filtered.length === 0) { list.innerHTML = '<div class="empty" style="padding:30px"><div class="empty-icon">📥</div>Talep yok</div>'; return; }
  
  const sC = {pending:'#f59e0b',called:'#3b82f6',scheduled:'#22c55e',confirmed:'#22c55e',lost:'#6b7280',cancelled:'#6b7280',completed:'#8b5cf6',noshow:'#ef4444'};
  const sL = {pending:'⏳ Bekliyor',called:'📞 Arandı',scheduled:'📅 Takvimde',confirmed:'✅ Onaylı',lost:'❌ Olumsuz',cancelled:'🚫 İptal',completed:'🏥 Tamamlandı',noshow:'❌ Gelmedi'};
  
  list.innerHTML = filtered.map(e => {
    const nm = e.patient_name || e.phone_number;
    const dt = new Date(e.created_at).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    const active = selectedAptId === e.id ? 'border-right:3px solid var(--accent-primary);background:rgba(99,102,241,0.08);' : '';
    const schedDate = e.scheduled_date ? new Date(e.scheduled_date).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    return `<div onclick="loadAptDetail(${e.id})" style="padding:10px 12px;background:var(--bg-hover);border-radius:10px;margin-bottom:6px;cursor:pointer;border-left:3px solid ${sC[e.status]||'#6b7280'};transition:all 0.15s;${active}" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:600;font-size:13px;">${escapeHtml(nm)}</span>
        <span style="font-size:10px;color:${sC[e.status]};font-weight:600;">${sL[e.status]||e.status}</span>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;">
        ${e.department?`<span style="font-size:10px;background:var(--accent-primary);color:white;padding:1px 6px;border-radius:4px;">🩺 ${e.department}</span>`:''}
        ${e.city?`<span style="font-size:10px;color:var(--text-muted);">📍 ${escapeHtml(e.city)}</span>`:''}
        ${schedDate?`<span style="font-size:10px;color:#22c55e;">📅 ${schedDate}</span>`:`<span style="font-size:10px;color:var(--text-muted);">🕐 ${dt}</span>`}
      </div>
    </div>`;
  }).join('');
}

async function loadAppointments() {
  const data = await api('appointments');
  if (!data) return;
  calendarEventsData = data.events || [];
  
  const c = data.counts || {};
  const completed = calendarEventsData.filter(e => e.status === 'completed').length;
  document.getElementById('apt-total').textContent = calendarEventsData.length;
  document.getElementById('apt-pending').textContent = c.pending || 0;
  document.getElementById('apt-called').textContent = c.called || 0;
  document.getElementById('apt-scheduled-count').textContent = c.scheduled || 0;
  document.getElementById('apt-completed').textContent = completed;
  document.getElementById('apt-lost').textContent = c.lost || 0;
  
  const badge = document.getElementById('apt-badge');
  if ((c.pending||0) > 0) { badge.textContent = c.pending; badge.style.display = 'inline'; }
  else { badge.style.display = 'none'; }
  
  renderAptList();
  filterCalendar();
}

async function loadAptDetail(eventId) {
  selectedAptId = eventId;
  renderAptList();
  
  if (window.innerWidth <= 768) navigateMobileAptView('detail');
  
  const panel = document.getElementById('apt-detail-content');
  panel.innerHTML = '<div style="padding:20px;"><div class="skeleton skeleton-text" style="width:60%;height:20px;margin-bottom:12px;"></div><div class="skeleton skeleton-text short"></div><div class="skeleton skeleton-card" style="margin-top:16px;"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>';
  
  const data = await api('appointment-detail&id=' + eventId);
  if (!data || !data.event) { panel.innerHTML = '<div class="empty">Detay yüklenemedi</div>'; return; }
  
  const e = data.event;
  const msgs = data.messages || [];
  const reminders = data.reminders || [];
  const nm = e.patient_name || e.phone_number;
  
  const allStatuses = [
    {key:'pending',emoji:'⏳',label:'Bekliyor',color:'#f59e0b'},
    {key:'called',emoji:'📞',label:'Arandı',color:'#3b82f6'},
    {key:'scheduled',emoji:'📅',label:'Takvimde',color:'#22c55e'},
    {key:'confirmed',emoji:'✅',label:'Onaylandı',color:'#10b981'},
    {key:'completed',emoji:'🏥',label:'Tamamlandı',color:'#8b5cf6'},
    {key:'noshow',emoji:'❌',label:'Gelmedi',color:'#ef4444'},
    {key:'lost',emoji:'🚫',label:'Olumsuz',color:'#6b7280'}
  ];
  const currentIdx = allStatuses.findIndex(s => s.key === e.status);
  
  const pipelineHtml = allStatuses.map((s, i) => {
    const isActive = s.key === e.status;
    const isPast = i < currentIdx;
    const bg = isActive ? s.color+'22' : isPast ? s.color+'0a' : 'transparent';
    const border = isActive ? s.color : isPast ? s.color+'44' : 'var(--border-color)';
    const fw = isActive ? '700' : '500';
    const opacity = isActive ? '1' : isPast ? '0.7' : '0.5';
    return `<button onclick="updateAppointment(${e.id},'${s.key}')" style="display:flex;align-items:center;gap:4px;padding:5px 10px;border-radius:8px;border:1px solid ${border};background:${bg};color:${isActive?s.color:'var(--text-muted)'};cursor:pointer;font-size:11px;font-weight:${fw};opacity:${opacity};transition:all 0.2s;white-space:nowrap;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='${opacity}'">${s.emoji} ${s.label}</button>`;
  }).join('');
  
  // Form yanıtları
  let formHtml = '';
  try {
    const raw = typeof e.raw_data === 'string' ? JSON.parse(e.raw_data || '{}') : (e.raw_data || {});
    const skip = ['id','leadgen_id','form_id','ad_id','adset_id','campaign_id','platform','is_organic','created_time','phone_number_id','full_name','phone_number'];
    const entries = Object.entries(raw).filter(([k]) => !skip.includes(k.toLowerCase()));
    if (entries.length > 0) {
      formHtml = entries.map(([k,v]) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);gap:8px;">
        <span style="font-size:11px;color:var(--text-muted);min-width:90px;">${escapeHtml(k.replace(/_/g,' '))}</span>
        <span style="font-size:11px;font-weight:500;text-align:right;word-wrap:break-word;">${escapeHtml(String(v||'').replace(/_/g,' '))}</span>
      </div>`).join('');
    }
  } catch(err) {}
  
  // Mesaj timeline
  const msgHtml = msgs.length > 0 ? msgs.slice(-5).map(m => {
    const isOut = m.direction === 'out';
    const t = new Date(m.created_at).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
    const content = escapeHtml((m.content||'').substring(0,120)) + ((m.content||'').length > 120 ? '...' : '');
    return `<div style="padding:5px 8px;background:${isOut?'rgba(99,102,241,0.08)':'rgba(255,255,255,0.03)'};border-radius:8px;margin-bottom:3px;border-left:2px solid ${isOut?'var(--accent-primary)':'#f59e0b'};">
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:1px;">${isOut?(m.model_used==='panel'?'👤 Sen':'🤖 Bot'):'📩 Hasta'} · ${t}</div>
      <div style="font-size:12px;line-height:1.4;">${content}</div>
    </div>`;
  }).join('') : '<div style="color:var(--text-muted);font-size:12px;">Henüz mesaj yok</div>';
  
  // Hatırlatma badges
  const reminderBadges = reminders.length > 0 ? reminders.map(r => {
    const d = new Date(r.created_at).toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    let rType = 'Hatırlatma';
    const c = r.content || '';
    if (c.includes('3 gün')) rType = 'D-3';
    else if (c.includes('Yarın')) rType = 'D-1';
    else if (c.includes('Bugün')) rType = 'D-0';
    return `<span style="font-size:10px;background:rgba(34,197,94,0.15);color:#22c55e;padding:3px 6px;border-radius:6px;" title="${escapeHtml(c)}">✅ ${rType} — ${d}</span>`;
  }).join(' ') : '<span style="font-size:10px;color:var(--text-muted);font-style:italic;">Henüz hatırlatma yok</span>';

  // Show-up section
  let showUpHtml = '';
  if (['scheduled','confirmed'].includes(e.status)) {
    showUpHtml = `<div style="display:flex;gap:6px;margin-top:8px;">
      <button onclick="markShowUp(${e.id},true)" style="flex:1;padding:8px;border-radius:8px;border:1px solid #22c55e;background:rgba(34,197,94,0.1);color:#22c55e;cursor:pointer;font-size:12px;font-weight:600;">✅ Hasta Geldi</button>
      <button onclick="markShowUp(${e.id},false)" style="flex:1;padding:8px;border-radius:8px;border:1px solid #ef4444;background:rgba(239,68,68,0.1);color:#ef4444;cursor:pointer;font-size:12px;font-weight:600;">❌ Gelmedi</button>
    </div>`;
  } else if (e.showed_up === true) {
    showUpHtml = `<div style="padding:8px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;text-align:center;font-size:12px;color:#22c55e;font-weight:600;">✅ Hasta geldi${e.treatment_completed?' — Tedavi tamamlandı':''}</div>`;
  } else if (e.showed_up === false) {
    showUpHtml = `<div style="padding:8px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;text-align:center;font-size:12px;color:#ef4444;font-weight:600;">❌ Hasta gelmedi${e.no_show_reason?' — '+e.no_show_reason:''}</div>`;
  }

  panel.innerHTML = `
    <div style="padding:20px;display:flex;flex-direction:column;gap:14px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="mobile-only-btn btn-back" onclick="navigateMobileAptView('list')" title="Geri">‹</button>
          <div>
            <div style="font-size:18px;font-weight:700;">${escapeHtml(nm)}</div>
            <div style="display:flex;gap:10px;margin-top:4px;flex-wrap:wrap;align-items:center;">
              <span style="font-size:12px;color:var(--text-muted);">📱 ${escapeHtml(e.phone_number)}</span>
              ${e.city?`<span style="font-size:12px;color:var(--text-muted);">📍 ${escapeHtml(e.city)}</span>`:''}
              ${e.email?`<span style="font-size:12px;color:var(--text-muted);">✉️ ${escapeHtml(e.email)}</span>`:''}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button onclick="window.open('https://wa.me/${e.phone_number.replace(/[^0-9]/g,'')}','_blank')" style="padding:6px 10px;border-radius:8px;border:1px solid #25D366;background:rgba(37,211,102,0.1);color:#25D366;cursor:pointer;font-size:11px;font-weight:600;">💬 WhatsApp</button>
          <button onclick="document.querySelector('[data-page=conversations]').click();setTimeout(()=>loadChat('${e.phone_number}','whatsapp'),300)" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:var(--text-muted);cursor:pointer;font-size:11px;">💬 Sohbet</button>
        </div>
      </div>
      
      <!-- Info Grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="background:rgba(255,255,255,0.03);padding:8px 10px;border-radius:8px;">
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;margin-bottom:2px;">Bölüm</div>
          <div style="font-size:13px;font-weight:600;">${e.department||'Genel'}</div>
        </div>
        <div style="background:rgba(255,255,255,0.03);padding:8px 10px;border-radius:8px;">
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;margin-bottom:2px;">Kaynak</div>
          <div style="font-size:11px;">${e.form_name||'—'}</div>
        </div>
      </div>
      
      <!-- Pipeline Status -->
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px;">🔄 Süreç Durumu</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">${pipelineHtml}</div>
      </div>
      
      <!-- Schedule Section -->
      <div style="background:rgba(34,197,94,0.06);padding:10px 12px;border-radius:10px;border:1px solid rgba(34,197,94,0.15);">
        <div style="font-size:11px;font-weight:600;color:#22c55e;text-transform:uppercase;margin-bottom:6px;">📅 Randevu Planlama</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <input type="datetime-local" id="apt-date-input" value="${e.scheduled_date ? new Date(new Date(e.scheduled_date).getTime() + 3*3600000).toISOString().slice(0,16) : ''}" style="background:var(--bg-main);border:1px solid var(--border-color);color:white;padding:6px 8px;border-radius:8px;font-size:12px;flex:1;min-width:160px;outline:none;">
          <input type="text" id="apt-doctor-input" placeholder="Doktor adı" value="${e.assigned_doctor||''}" style="background:var(--bg-main);border:1px solid var(--border-color);color:white;padding:6px 8px;border-radius:8px;font-size:12px;flex:1;min-width:120px;outline:none;">
          <button onclick="saveAptDate(${e.id})" style="background:#22c55e;color:white;border:none;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">💾 Kaydet</button>
        </div>
        ${showUpHtml}
      </div>
      
      <!-- Reminders -->
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">📩 Hatırlatmalar</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">${reminderBadges} ${e.confirmed_by_patient?'<span style="font-size:10px;background:rgba(34,197,94,0.15);color:#22c55e;padding:3px 6px;border-radius:4px;font-weight:700;">✅ Hasta Teyit Etti</span>':''}</div>
      </div>
      
      <!-- Coordinator Note -->
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">📝 Koordinatör Notu</div>
        <div style="display:flex;gap:6px;">
          <textarea id="apt-coord-note" placeholder="Not ekle..." style="flex:1;min-height:40px;background:var(--bg-hover);border:1px solid var(--border-color);border-radius:8px;padding:6px 8px;color:white;font-size:12px;resize:vertical;">${e.coordinator_notes||''}</textarea>
          <button onclick="saveCoordNote(${e.id})" style="align-self:flex-end;padding:6px 10px;background:var(--accent-primary);color:white;border:none;border-radius:6px;font-size:11px;cursor:pointer;">💾</button>
        </div>
      </div>
      
      ${formHtml?`<!-- Form Data (Collapsible) -->
      <details style="background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid rgba(255,255,255,0.04);">
        <summary style="padding:8px 10px;cursor:pointer;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;">📋 Form Yanıtları</summary>
        <div style="padding:4px 10px 8px;">${formHtml}</div>
      </details>`:''}
      
      <!-- Messages (Collapsible) -->
      <details open style="background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid rgba(255,255,255,0.04);">
        <summary style="padding:8px 10px;cursor:pointer;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;">💬 Son Mesajlar (${msgs.length})</summary>
        <div style="padding:4px 10px 8px;max-height:200px;overflow-y:auto;">${msgHtml}</div>
      </details>
      
      <!-- Quick Actions -->
      <div style="display:flex;gap:6px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">
        ${e.scheduled_date?`<button onclick="downloadIcal(${e.id})" style="padding:6px 12px;border-radius:8px;border:1px solid rgba(99,102,241,0.3);background:rgba(99,102,241,0.1);color:var(--accent-primary);cursor:pointer;font-size:11px;">📅 iCal İndir</button>`:''}
      </div>
    </div>`;
}
  

async function saveCoordNote(id) {
  const note = document.getElementById('apt-coord-note').value;
  await api('update-appointment','POST',{id, coordinator_notes: note});
  showNotification('Koordinatör notu kaydedildi ✅', 'success');
}

async function saveAptDate(id) {
  const dt = document.getElementById('apt-date-input').value;
  const doctor = document.getElementById('apt-doctor-input')?.value || '';
  if (!dt) return toast('Lütfen bir tarih seçin', 'error');
  
  const d = new Date(dt);
  await api('update-appointment', 'POST', { id, scheduled_date: d.toISOString(), status: 'scheduled', assigned_doctor: doctor || null });
  toast('📅 Randevu kaydedildi ✅');
  loadAppointments();
  loadAptDetail(id);
}

function downloadIcal(id) {
  window.open(`/api/panel?action=appointment-ical&id=${id}`, '_blank');
}

function filterCalendar() {
  const q = (document.getElementById('calendar-search')?.value || '').toLowerCase();
  const dateStr = document.getElementById('calendar-date-picker')?.value;
  let cal = calendarEventsData.filter(e => ['scheduled','confirmed','completed'].includes(e.status));
  if (dateStr) {
    cal = cal.filter(e => e.scheduled_date && e.scheduled_date.startsWith(dateStr));
    document.getElementById('calendar-day-title').textContent = new Date(dateStr).toLocaleDateString('tr-TR',{weekday:'long',day:'numeric',month:'long'});
  } else {
    document.getElementById('calendar-day-title').textContent = 'Tüm Gelecek Randevular';
  }
  if (q) cal = cal.filter(e => (e.patient_name||'').toLowerCase().includes(q) || (e.phone_number||'').includes(q) || (e.department||'').toLowerCase().includes(q));
  cal.sort((a,b) => new Date(a.scheduled_date) - new Date(b.scheduled_date));
  document.getElementById('apt-scheduled').textContent = cal.length;
  
  const list = document.getElementById('calendar-list');
  if (cal.length === 0) { list.innerHTML = '<div class="empty"><div class="empty-icon">🗓️</div>Takvimli randevu yok</div>'; return; }
  
  list.innerHTML = cal.map(e => {
    const nm = e.patient_name || e.phone_number;
    const ts = e.scheduled_date ? new Date(e.scheduled_date).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:14px;background:var(--bg-hover);border-radius:10px;margin-bottom:6px;border-left:3px solid #22c55e;">
      <div style="flex:1"><div style="font-weight:600;font-size:14px;">${nm}</div>
        <div style="display:flex;gap:12px;margin-top:4px;flex-wrap:wrap;">
          <span style="color:#22c55e;font-weight:600;font-size:12px;">🕒 ${ts}</span>
          ${e.assigned_doctor?`<span style="font-size:12px;">👨‍⚕️ ${e.assigned_doctor}</span>`:''}
          ${e.department?`<span style="font-size:11px;background:var(--accent-primary);color:white;padding:1px 6px;border-radius:4px;">🩺 ${e.department}</span>`:''}
        </div>
      </div>
      <div style="display:flex;gap:4px;align-items:center;">
        ${e.showed_up==null?`<button class="btn btn-sm" onclick="markShowUp(${e.id},true)" style="font-size:10px;padding:3px 8px;background:#22c55e;color:white;border:none;border-radius:6px;">Geldi ✅</button><button class="btn btn-sm" onclick="markShowUp(${e.id},false)" style="font-size:10px;padding:3px 8px;background:#ef4444;color:white;border:none;border-radius:6px;">Gelmedi ❌</button>`:''}
        ${e.showed_up===true?'<span style="background:#22c55e;color:white;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600;">✅ GELDİ</span>':''}
        ${e.showed_up===false?'<span style="background:#ef4444;color:white;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600;">❌ GELMEDİ</span>':''}
        <button class="btn btn-sm" onclick="downloadIcal(${e.id})" style="font-size:10px;padding:3px 8px;background:transparent;border:1px solid var(--border-color);border-radius:6px;color:var(--text-muted);">📅</button>
      </div>
    </div>`;
  }).join('');
}

async function updateAppointment(id,status) { if(!status)return; await api('update-appointment','POST',{id,status}); loadAppointments(); if(selectedAptId===id) loadAptDetail(id); toast('Durum güncellendi ✅'); }

async function markShowUp(id, showedUp) {
  if (showedUp) { await api('update-showup','POST',{id,showed_up:true}); toast('✅ Hasta geldi'); }
  else { const r = prompt('Gelmeme nedeni (opsiyonel):') || 'Bilinmiyor'; await api('update-showup','POST',{id,showed_up:false,no_show_reason:r}); toast('❌ No-show'); }
  loadAppointments();
}

async function markTreatmentDone(id) {
  const s = parseInt(prompt('Memnuniyet puanı (1-5):')||'0');
  await api('update-showup','POST',{id,showed_up:true,treatment_completed:true,satisfaction_score:(s>=1&&s<=5)?s:null});
  toast('🏥 Tedavi tamamlandı'); loadAppointments();
}

// ========== BİLDİRİM SİSTEMİ ==========
async function checkNotifications() {
  try {
    const data = await api('notifications');
    if (!data) return;
    const bell = document.getElementById('notif-bell');
    const count = document.getElementById('notif-count');
    if (data.total > 0) { bell.style.display = 'flex'; count.textContent = data.total; }
    else { bell.style.display = 'none'; }
    const badge = document.getElementById('apt-badge');
    if (data.pendingAppointments > 0) { badge.textContent = data.pendingAppointments; badge.style.display = 'inline'; }
  } catch(e) {}
}
function showNotifications() {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-page="appointments"]').classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-appointments').classList.add('active');
  loadAppointments();
}

// ========== GELİŞMİŞ ANALİTİK ==========
async function loadAdvancedAnalytics() {
  const data = await api('advanced-analytics');
  if (!data) return;
  let cHtml = '<table style="width:100%;font-size:13px;border-collapse:collapse"><tr style="border-bottom:1px solid var(--border-color)"><th style="text-align:left;padding:8px">Kampanya</th><th>Lead</th><th>Cevap</th><th>Randevu</th><th>Dönüşüm</th></tr>';
  (data.campaignConversion||[]).forEach(c => {
    const rate = c.total > 0 ? Math.round((Number(c.appointed)/Number(c.total))*100) : 0;
    const cl = rate>20?'#22c55e':rate>10?'#f59e0b':'#ef4444';
    cHtml += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05)"><td style="padding:6px 8px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${c.form_name}</td><td style="text-align:center">${c.total}</td><td style="text-align:center">${c.responded}</td><td style="text-align:center">${c.appointed}</td><td style="text-align:center;color:${cl};font-weight:600">${rate}%</td></tr>`;
  });
  cHtml += '</table>';
  const el = document.getElementById('advanced-analytics-content');
  if (el) el.innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
      <div class="stat-card"><div class="stat-value" style="color:#3b82f6">${data.botMessages}</div><div class="stat-label">🤖 Bot Mesajı</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#8b5cf6">${data.humanMessages}</div><div class="stat-label">👤 Personel Mesajı</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#22c55e">${data.intlPatients}/${data.totalPatients}</div><div class="stat-label">🌍 Uluslararası</div></div>
      <div class="stat-card"><div class="stat-value" style="color:#f59e0b">${data.avgResponseSeconds>0?Math.round(data.avgResponseSeconds)+'s':'—'}</div><div class="stat-label">⚡ Ort. Yanıt</div></div>
    </div>
    <div class="stats-grid" style="grid-template-columns:1fr 1fr">
      <div class="card"><h2>📊 Kampanya Dönüşüm</h2>${cHtml}</div>
      <div class="card"><h2>🏥 Bölüm Talep Dağılımı</h2>${(data.departmentDemand||[]).map(d=>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><span style="font-size:13px">${d.name}</span><div style="display:flex;align-items:center;gap:8px"><div style="width:${Math.min(d.count*15,200)}px;height:8px;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:4px"></div><span style="font-size:12px;font-weight:600;min-width:24px;text-align:right">${d.count}</span></div></div>`
      ).join('')}</div>
    </div>`;
}

// Başlatıcı
checkAuth();

// Otomatik yenileme + bildirim (8 saniyede bir)
setInterval(async () => {
  const page = document.querySelector('.page.active')?.id;
  // Komuta Merkezi polling'den çıkarıldı — analitik sorguları ağır, manuel yenileme yeterli
  // loadKanban kaldırıldı — pipeline filtreleri inbox'ta
  if (page === 'page-appointments') loadAppointments();
  if (page === 'page-conversations' && currentPhone) {
    const msgs = await api('conversation-detail&phone=' + currentPhone);
    if (!msgs) return;
    const chatEl = document.getElementById('chat-messages');
    const currentCount = chatEl.querySelectorAll('.message-bubble').length;
    if (msgs.length > currentCount) loadChat(currentPhone, currentChannel);
  }
  checkNotifications();
  fetchZorbayAlerts();
}, 8000);

// ========== ZORBAY ALERT SİSTEMİ ==========
async function fetchZorbayAlerts() {
  try {
    const alerts = await api('alerts');
    if (!alerts || !alerts.length) return;
    
    // Yalnızca ekranda olmayanları ekle
    alerts.forEach(alert => {
      // Bildirim zili paneline (soldaki menüye) ekle
      const titleText = alert.alert_type === 'hot_lead' ? '🔥 Sıcak Lead (Manuel)' : alert.alert_type === 'new_image' ? '📸 Görüntü/Rapor' : '🚨 CRM Uyarısı';
      const sev = alert.alert_type === 'hot_lead' ? 'critical' : 'warning';
      
      const allNotifs = _notifStore.getAll();
      const exists = allNotifs.find(n => n.dbId === alert.id);
      
      if (!exists) {
        _notifStore.add({
          title: titleText,
          desc: alert.message,
          severity: sev,
          icon: '🚨',
          phone: alert.phone_number,
          dbId: alert.id
        });
        updateNotifBadge();
        
        // Sesi çal (Kullanıcı etkileşimi olduysa çalar)
        try { new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play(); } catch(e){}
      }
    });
  } catch (e) { console.error('Alert fetch error', e); }
}

// =========================================================================
// REAL-TIME SWR POLLING (Vercel Serverless Optimizasyonu)
// =========================================================================
let pollInterval = null;
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  
  pollInterval = setInterval(async () => {
    // Sadece sekme açıkken ve kullanıcı uygulamaya bakıyorken istek at (Vercel tasarrufu)
    if (document.visibilityState !== 'visible') return;
    
    const activePage = document.querySelector('.nav-btn.active')?.dataset?.page;
    
    if (activePage === 'conversations') {
      // 1. Sol paneli güncelle (Contact List)
      const list = await api('conversations', 'GET', null, true); // true = sessiz (hata gösterme)
      if (list && JSON.stringify(list) !== JSON.stringify(cachedConversations)) {
        cachedConversations = list;
        renderConversationList();
      }
      
      // 2. Açık olan mesajlaşmayı güncelle
      if (currentPhone) {
        const data = await api('conversation-detail&phone='+currentPhone, 'GET', null, true);
        if (data) {
          const msgs = data.messages || data;
          const chatEl = document.getElementById('chat-messages');
          
          if (chatEl && msgs.length !== lastChatLength) {
            // Scroll en altta mı kontrol et
            const isScrolledToBottom = chatEl.scrollHeight - chatEl.clientHeight <= chatEl.scrollTop + 50;
            
            chatEl.innerHTML = msgs.map(m => {
              const isOut = m.direction === 'out';
              const isBot = m.model_used && m.model_used !== 'panel' && m.model_used !== 'toplu';
              const cls = `message-bubble ${isOut ? 'out' : 'in'} ${isOut && isBot ? 'bot-reply' : ''}`;
              const senderLabel = isOut ? (isBot ? '🤖 Bot' : '👤 Sen') : '📩 Hasta';
              const info = `<div class="msg-info">${senderLabel} · ${new Date(m.created_at).toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit'})} ${isBot ? '<span class="bot-indicator">' + m.model_used + '</span>' : ''}</div>`;
              
              let content = m.content;
              if (m.media_url) {
                if (m.media_type === 'image') content = `<img src="${m.media_url}" style="max-width:240px;border-radius:8px;margin-bottom:4px;"><br>${m.content||''}`;
                else content = `📎 <a href="${m.media_url}" target="_blank" style="color:inherit;text-decoration:underline">${m.content||'Dosya'}</a>`;
              }
              return `<div class="${cls}">${content}${info}</div>`;
            }).join('');
            
            // Eğer yeni mesaj geldiyse veya önceden alttaysa scrollu en alta çek
            if (isScrolledToBottom || msgs.length > lastChatLength) {
              chatEl.scrollTop = chatEl.scrollHeight;
              
              // Sesli bildirim (Opsiyonel ama premium bir his verir)
              if (msgs.length > lastChatLength && msgs[msgs.length - 1].direction === 'in') {
                try { new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play(); } catch(e) {}
              }
            }
            lastChatLength = msgs.length;
          }
        }
      }
    }
  }, 3000); // 3 saniyede bir kontrol et
}

async function dismissZorbayAlert(id, phone) {
  const el = document.getElementById('zorbay-alert-' + id);
  if (el) el.remove();
  await api('mark-alert-read', 'POST', { id });
}

