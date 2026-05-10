const API = '/api/panel'; 
let AUTH_TOKEN = localStorage.getItem('panel_auth') || ''; 
let currentPhone = ''; 
let currentChannel = 'whatsapp';
let allTags = [];

function getChannelIcon(channel) {
  if (channel === 'messenger') return '<div class="channel-icon channel-messenger">M</div>';
  if (channel === 'instagram') return '<div class="channel-icon channel-instagram">IG</div>';
  return '<div class="channel-icon channel-whatsapp">W</div>';
}
function getChannelBadge(channel) {
  if (channel === 'messenger') return '<span style="color:#0084FF">Ⓜ️ Messenger</span>';
  if (channel === 'instagram') return '<span style="color:#e1306c">📸 Instagram</span>';
  return '<span style="color:#25D366">📱 WhatsApp</span>';
}

// Ülke kodu tespiti
const COUNTRY_MAP = [
  ['90','🇹🇷','Türkiye'],['49','🇩🇪','Almanya'],['44','🇬🇧','İngiltere'],['33','🇫🇷','Fransa'],
  ['31','🇳🇱','Hollanda'],['32','🇧🇪','Belçika'],['43','🇦🇹','Avusturya'],['41','🇨🇭','İsviçre'],
  ['46','🇸🇪','İsveç'],['45','🇩🇰','Danimarka'],['47','🇳🇴','Norveç'],['358','🇫🇮','Finlandiya'],
  ['39','🇮🇹','İtalya'],['34','🇪🇸','İspanya'],['351','🇵🇹','Portekiz'],['30','🇬🇷','Yunanistan'],
  ['48','🇵🇱','Polonya'],['420','🇨🇿','Çekya'],['36','🇭🇺','Macaristan'],['40','🇷🇴','Romanya'],
  ['359','🇧🇬','Bulgaristan'],['381','🇷🇸','Sırbistan'],['385','🇭🇷','Hırvatistan'],
  ['387','🇧🇦','Bosna Hersek'],['355','🇦🇱','Arnavutluk'],['383','🇽🇰','Kosova'],
  ['389','🇲🇰','K.Makedonya'],['382','🇲🇪','Karadağ'],
  ['1','🇺🇸','ABD/Kanada'],['7','🇷🇺','Rusya'],['380','🇺🇦','Ukrayna'],
  ['375','🇧🇾','Belarus'],['370','🇱🇹','Litvanya'],['371','🇱🇻','Letonya'],['372','🇪🇪','Estonya'],
  ['966','🇸🇦','S.Arabistan'],['971','🇦🇪','BAE'],['974','🇶🇦','Katar'],
  ['973','🇧🇭','Bahreyn'],['965','🇰🇼','Kuveyt'],['968','🇴🇲','Umman'],
  ['964','🇮🇶','Irak'],['963','🇸🇾','Suriye'],['962','🇯🇴','Ürdün'],
  ['961','🇱🇧','Lübnan'],['970','🇵🇸','Filistin'],['972','🇮🇱','İsrail'],
  ['20','🇪🇬','Mısır'],['212','🇲🇦','Fas'],['213','🇩🇿','Cezayir'],['216','🇹🇳','Tunus'],
  ['218','🇱🇾','Libya'],['249','🇸🇩','Sudan'],['98','🇮🇷','İran'],
  ['92','🇵🇰','Pakistan'],['91','🇮🇳','Hindistan'],['93','🇦🇫','Afganistan'],
  ['994','🇦🇿','Azerbaycan'],['995','🇬🇪','Gürcistan'],['996','🇰🇬','Kırgızistan'],
  ['998','🇺🇿','Özbekistan'],['993','🇹🇲','Türkmenistan'],['992','🇹🇯','Tacikistan'],
  ['77','🇰🇿','Kazakistan'],['86','🇨🇳','Çin'],['82','🇰🇷','G.Kore'],['81','🇯🇵','Japonya'],
  ['60','🇲🇾','Malezya'],['62','🇮🇩','Endonezya'],['66','🇹🇭','Tayland'],
  ['55','🇧🇷','Brezilya'],['52','🇲🇽','Meksika'],['54','🇦🇷','Arjantin'],
  ['234','🇳🇬','Nijerya'],['27','🇿🇦','G.Afrika'],['254','🇰🇪','Kenya'],
  ['233','🇬🇭','Gana'],['251','🇪🇹','Etiyopya'],['256','🇺🇬','Uganda'],
  ['61','🇦🇺','Avustralya'],['64','🇳🇿','Yeni Zelanda']
];
// Uzun kodlar önce denensin
COUNTRY_MAP.sort((a,b) => b[0].length - a[0].length);

function getCountry(phone) {
  if (!phone) return null;
  const p = String(phone).replace(/[^0-9]/g, '');
  for (const [code, flag, name] of COUNTRY_MAP) {
    if (p.startsWith(code)) return { code, flag, name };
  }
  return null;
}
function countryBadge(phone) {
  const c = getCountry(phone);
  if (!c) return '';
  return `<span class="country-badge">${c.flag} ${c.name}</span>`;
}

function doLogin() { AUTH_TOKEN = document.getElementById('login-pass').value; localStorage.setItem('panel_auth', AUTH_TOKEN); checkAuth(); }
async function checkAuth() {
  try {
    const r = await fetch(API+'?action=dashboard', {headers:{Authorization:'Bearer '+AUTH_TOKEN}});
    if(r.ok) { document.getElementById('login-screen').style.display='none'; document.getElementById('main-app').style.display='flex'; loadDashboard(); }
    else { document.getElementById('login-screen').style.display='flex'; document.getElementById('main-app').style.display='none'; document.getElementById('login-error').textContent=AUTH_TOKEN?'Hatalı Şifre':''; }
  } catch(e) { document.getElementById('login-error').textContent='Bağlantı koptu.'; }
}

document.querySelectorAll('.nav-btn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.page').forEach(x => {
      x.classList.remove('active');
      x.style.display = ''; // Manuel display stillerini sıfırla (form-detail vb.)
    });
    b.classList.add('active');
    document.getElementById('page-' + b.dataset.page).classList.add('active');
    
    // Form management'a dönüşte fm-view-sheets'i göster
    if (b.dataset.page === 'form-management') {
      document.getElementById('fm-view-sheets').style.display = '';
    }
    
    // Yükleme fonksiyonları
    ({dashboard:loadDashboard, kanban:loadKanban, leads:loadSheets, conversations:loadConversations, training:loadPrompt, templates:loadTemplates, analytics:loadAnalytics, settings:loadSettings, appointments:loadAppointments, 'form-management':loadFormManagement})[b.dataset.page]?.();
    // Mobilde sidebar'ı kapat
    document.getElementById('sidebar')?.classList.remove('open');
  });
});

function toast(m, t='success') { const el=document.getElementById('toast'); el.textContent=m; el.className='toast show '+t; setTimeout(()=>el.className='toast', 3000); }

async function api(a, m='GET', b=null) {
  const o = {method:m, headers:{'Content-Type':'application/json', Authorization:'Bearer '+AUTH_TOKEN}};
  if(b) o.body = JSON.stringify(b);
  const r = await fetch(API+'?action='+a, o);
  if(r.status===401) { checkAuth(); return null; }
  return r.json();
}

/* DASHBOARD */
async function loadDashboard() {
  const d = await api('dashboard'); if(!d) return;
  document.getElementById('stat-today').textContent = d.todayMessages;
  document.getElementById('stat-total').textContent = d.totalMessages;
  document.getElementById('stat-conversations').textContent = d.activeConversations;
  document.getElementById('stat-human').textContent = d.humanConversations || 0;
  
  // Lead istatistikleri
  if (d.leadStats) {
    document.getElementById('stat-today-leads').textContent = d.leadStats.todayLeads || 0;
    document.getElementById('stat-total-leads').textContent = d.leadStats.totalLeads || 0;
    document.getElementById('stat-appointed-leads').textContent = d.leadStats.appointed || 0;
    document.getElementById('stat-lost-leads').textContent = d.leadStats.lost || 0;
    
    // Kampanya performansı
    const campEl = document.getElementById('campaign-stats');
    const camps = d.leadStats.campaigns || [];
    if (camps.length > 0) {
      campEl.innerHTML = camps.map(c => {
        const pct = c.count > 0 ? Math.round((c.appointed / c.count) * 100) : 0;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--bg-card);border-radius:12px;margin-bottom:8px;">
          <div style="flex:1;"><div style="font-weight:600;font-size:13px;margin-bottom:2px;">${c.form_name}</div>
            <div style="font-size:11px;color:var(--text-muted)">${c.count} lead · ${c.appointed || 0} randevu</div></div>
          <div style="text-align:right;"><span style="font-weight:700;font-size:15px;color:${pct>=30?'var(--system-green)':(pct>=10?'var(--system-orange)':'var(--system-red)')}">${pct}%</span>
            <div style="font-size:10px;color:var(--text-muted)">dönüşüm</div></div>
        </div>`;
      }).join('');
    } else {
      campEl.innerHTML = '<div class="empty" style="padding:20px"><div class="empty-icon">📊</div>Henüz kampanya verisi yok</div>';
    }
  }
  
  document.getElementById('recent-messages').innerHTML = (d.recentMessages||[]).map(m => {
    const icon = m.direction === 'in' ? '👤' : '🤖';
    const isBot = m.direction === 'out' ? 'background: rgba(10, 132, 255, 0.1); border: 1px solid transparent;' : 'background: var(--bg-hover); border: 1px solid transparent;';
    return `<div style="${isBot} padding: 12px 16px; border-radius: 14px; display:flex; gap:12px; align-items:center; margin-bottom: 8px;">
      <div style="font-size:20px; opacity:0.8;">${icon}</div>
      <div style="flex:1; overflow:hidden;">
        <div style="font-size:13px; font-weight:600; color:var(--text-main); margin-bottom:4px; letter-spacing: -0.2px;">${m.patient_name || m.phone_number}</div>
        <div style="font-size:13px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.content}</div>
      </div>
      <div style="font-size:11px; color:var(--text-muted); align-self:flex-start;">${new Date(m.created_at).toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'})}</div>
    </div>`;
  }).join('') || '<div class="empty">Etkileşim yok</div>';
}

// ========== FORM YÖNETİMİ ==========
function loadFormManagement() {
  loadSheets();
}

/* GOOGLE SHEETS ENTEGRASYONU (ESKİ SİSTEM) */
window._activeSheet = null; window._sheetRefreshTimer = null;
async function loadSheets() {
  document.getElementById('lead-list').innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-muted);">⏳ Google Sheets verileri yükleniyor...</p>';
  try {
    const resp = await fetch('/api/sheets'); const data = await resp.json();
    if(!data.success) return document.getElementById('lead-list').innerHTML = `<p class="empty">❌ Hata: ${data.error}</p>`;
    window._activeSheet = data.activeSheet;
    document.getElementById('sheet-tabs').innerHTML = data.tabs.map(t => `<button class="sheet-tab ${t.title === data.activeSheet ? 'active' : ''}" onclick="loadSheetData('${t.title.replace(/'/g, "\\'")}')">${t.title}</button>`).join('');
    renderSheetTable(data.headers, data.rows, data.total);
  } catch(e) { document.getElementById('lead-list').innerHTML = `<p class="empty">❌ Google Sheets bağlantı hatası</p>`; }
}

async function loadSheetData(sheetName) {
  window._activeSheet = sheetName;
  document.getElementById('lead-list').innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-muted);">⏳ Sekme yükleniyor...</p>';
  try {
    const tabResp = await fetch('/api/sheets?action=tabs'); const tabData = await tabResp.json();
    if(tabData.success) document.getElementById('sheet-tabs').innerHTML = tabData.tabs.map(t => `<button class="sheet-tab ${t.title === sheetName ? 'active' : ''}" onclick="loadSheetData('${t.title.replace(/'/g, "\\'")}')">${t.title}</button>`).join('');
    const resp = await fetch(`/api/sheets?action=data&sheet=${encodeURIComponent(sheetName)}`); const data = await resp.json();
    if(data.success) renderSheetTable(data.headers, data.rows, data.total);
  } catch(e) {}
}

function renderSheetTable(headers, rows, total) {
  document.getElementById('sheet-row-count').textContent = `📋 ${total} kayıt`;
  if(!headers || headers.length === 0) return document.getElementById('lead-list').innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div style="font-weight:500; font-size: 15px;">Bu kampanyada henüz kayıt yok</div></div>';

  // Sütun tespiti (tüm sekmelerde çalışması için geniş keyword listesi)
  const findCol = (keywords) => headers.findIndex(h => {
    const l = h.toLowerCase().replace(/[_\s]+/g, '');
    return keywords.some(k => l.includes(k));
  });

  let dateCol = findCol(['time', 'tarih', 'created', 'date', 'zaman']);
  // İsim sütunu: full_name / isim öncelikli (ad_name Meta reklam adıdır, karıştırma!)
  let nameCol = findCol(['fullname', 'full_name', 'isim', 'hastadi', 'hastaadi']);
  if (nameCol === -1) nameCol = headers.findIndex(h => /^ad$/i.test(h.trim()) || h.toLowerCase().includes('isim'));
  let phoneCol = headers.findIndex(h => {
    const l = h.toLowerCase().replace(/[_\s]+/g, '');
    return l === 'phonenumber' || l === 'phone' || l === 'telefon' || l === 'tel' || l === 'gsm' || l === 'cep';
  });
  let campaignCol = findCol(['campaignname', 'campaign_name', 'kampanya']);
  let deptCol = findCol(['adname', 'ad_name', 'campaign', 'bolum', 'bölüm', 'form']);
  let statusCol = findCol(['durum', 'status', 'leadstatus', 'lead_status', 'aşama']);
  let notesCol = findCol(['geridönüş', 'geridönus', 'geridönüs', 'notlar', 'notes', 'geridonus', 'açıklama', 'yorum']);

  if (dateCol === -1) dateCol = 0;
  if (nameCol === -1) nameCol = headers.length > 2 ? 2 : -1;

  // Kaydet (openLeadDetail kullanır)
  window._sheetHeaders = headers;
  window._sheetRows = rows;

  // Tarih formatlama yardımcı fonksiyonu: 🗓 09 May 2026 - 15:31
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function formatLeadDate(rawDate) {
    if (!rawDate) return '';
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return rawDate.split('T')[0];
    const day = String(d.getDate()).padStart(2, '0');
    const mon = monthNames[d.getMonth()];
    const year = d.getFullYear();
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${mon} ${year} - ${hour}:${min}`;
  }

  // EN YENİ FORMA GÖRE SIRALA
  const sortedRows = [...rows].sort((a, b) => {
    const da = dateCol > -1 ? new Date(a[dateCol] || 0) : 0;
    const db = dateCol > -1 ? new Date(b[dateCol] || 0) : 0;
    return db - da;
  });
  window._sortedRowMap = sortedRows.map(r => rows.indexOf(r));

  let html = `<div class="lead-list-view" style="display:flex; flex-direction:column; gap:8px; padding:0 16px 16px 16px;">`;
  const readLeads = JSON.parse(localStorage.getItem('readLeads') || '[]');

  sortedRows.forEach((row, si) => {
    const dateVal = dateCol > -1 ? formatLeadDate(row[dateCol]) : '';
    const nameVal = nameCol > -1 ? (row[nameCol] || 'Bilinmiyor') : 'Bilinmiyor';
    const phoneVal = phoneCol > -1 ? (row[phoneCol] || '') : '';
    const campaignVal = campaignCol > -1 ? (row[campaignCol] || '') : '';
    const deptVal = deptCol > -1 ? (row[deptCol] || '') : '';
    const statusVal = statusCol > -1 ? (row[statusCol] || '') : '';
    const notesVal = notesCol > -1 ? (row[notesCol] || '') : '';

    // Rozet belirleme (öncelik sırası: durum sütunu > notlar > yeni)
    let badgeHtml = '<span class="lead-badge badge-new" style="min-width:140px; text-align:center;">🟡 Yeni</span>';
    let isUnread = true;

    if (statusVal.includes('SİSTEME ALINDI') || statusVal.includes('İletişime Geçildi')) {
      badgeHtml = '<span class="lead-badge badge-contacted" style="min-width:140px; text-align:center;">🟢 Dönüş Yapıldı</span>';
      isUnread = false;
    } else if (statusVal.includes('Cevap Verdi') || statusVal.includes('İlgili')) {
      badgeHtml = '<span class="lead-badge badge-active" style="min-width:140px; text-align:center;">💬 İletişimde</span>';
      isUnread = false;
    } else if (statusVal && statusVal.toLowerCase() !== 'created' && statusVal.toLowerCase() !== '') {
      badgeHtml = `<span class="lead-badge badge-custom" style="min-width:140px; text-align:center;">${statusVal}</span>`;
      isUnread = false;
    } else if (notesVal.trim()) {
      badgeHtml = '<span class="lead-badge badge-contacted" style="min-width:140px; text-align:center;">✅ Cevap Verildi</span>';
      isUnread = false;
    }

    if (readLeads.includes(phoneVal || `row-${si}`)) isUnread = false;

    const unreadStyle = isUnread
      ? 'border-left: 4px solid #4ade80; background: rgba(74, 222, 128, 0.05);'
      : 'border-left: 4px solid transparent; background: var(--card-bg);';

    const campaignBadge = campaignVal ? `<span style="background:rgba(191,90,242,0.15); color:#bf5af2; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:500; white-space:nowrap;">📣 ${campaignVal.substring(0, 40)}${campaignVal.length > 40 ? '…' : ''}</span>` : '';

    html += `
      <div class="lead-card list-row" id="lead-row-${si}" onclick="openLeadDetail(${si})" style="display:flex; align-items:center; justify-content:space-between; border-radius:8px; padding:12px 16px; cursor:pointer; border:1px solid var(--border-color); transition:all 0.2s; ${unreadStyle}">
        <div style="display:flex; align-items:center; gap:24px; flex:1;">
          <div style="width:170px; font-size:12px; color:var(--text-muted);">🗓 ${dateVal}</div>
          <div style="width:200px;">
            <div style="font-weight:600; color:white; margin-bottom:4px;">👤 ${nameVal}</div>
            <div style="font-size:12px; color:#25D366; display:flex; align-items:center; gap:6px;">🟢 ${phoneVal} ${countryBadge(phoneVal)}</div>
          </div>
          <div style="flex:1; font-size:13px; color:var(--text-muted); display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            ${campaignBadge}
            ${deptVal ? `<span style="background:var(--bg-hover); padding:4px 8px; border-radius:4px;">🩺 ${deptVal.substring(0, 50)}${deptVal.length > 50 ? '...' : ''}</span>` : ''}
          </div>
          <div id="lead-enrich-${si}" style="display:flex; align-items:center; gap:6px; font-size:12px;"></div>
        </div>
        <div>${badgeHtml}</div>
      </div>
    `;
  });

  html += '</div>';
  document.getElementById('lead-list').innerHTML = html;
  enrichLeadCards(sortedRows, phoneCol);
}

async function enrichLeadCards(rows, phoneCol) {
  const token = localStorage.getItem('panel_token') || '';
  const batchSize = 5;
  for (let si = 0; si < rows.length; si += batchSize) {
    const batch = rows.slice(si, si + batchSize);
    await Promise.all(batch.map(async (row, bIdx) => {
      const idx = si + bIdx;
      const phone = phoneCol > -1 ? (row[phoneCol] || '') : '';
      if (!phone) return;
      try {
        const resp = await fetch(`/api/panel?action=lead-context&phone=${encodeURIComponent(phone)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const ctx = await resp.json();
        const el = document.getElementById(`lead-enrich-${idx}`);
        if (!el) return;
        let h = '';
        const icons = { whatsapp: '📱', instagram: '📸', messenger: '💬', web: '🌐' };
        (ctx.channels || []).forEach(ch => { h += `<span title="${ch}" style="font-size:14px;">${icons[ch] || '📞'}</span>`; });
        if (ctx.lastMessage) {
          h += `<span style="color:#60a5fa; font-size:11px; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${ctx.lastMessage.content}">&ldquo;${ctx.lastMessage.content.substring(0, 30)}...&rdquo;</span>`;
        }
        if (ctx.score > 0) {
          const sc = ctx.score >= 50 ? '#f97316' : ctx.score >= 30 ? '#facc15' : '#6b7280';
          h += `<span style="background:${sc}22; color:${sc}; border:1px solid ${sc}44; border-radius:4px; padding:2px 6px; font-weight:600; font-size:11px;">⚡ ${ctx.score}</span>`;
        }
        el.innerHTML = h;
      } catch(e) {}
    }));
  }
}


async function updateSheetCell(row, col, value) {
  try {
    const resp = await fetch('/api/sheets?action=update', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ sheetName: window._activeSheet, row, col, value })
    });
    const data = await resp.json();
    if (data.success) toast('✅ Güncellendi');
    else toast('❌ Hata: ' + data.error, 'error');
  } catch(e) {
    toast('❌ Bağlantı hatası', 'error');
  }
}

let currentInboxFilter = 'all';
let cachedConversations = [];

function smartDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Şimdi';
  if (mins < 60) return mins + ' dk';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDay.getTime() === today.getTime()) return d.toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit'});
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (msgDay.getTime() === yesterday.getTime()) return 'Dün';
  return d.toLocaleDateString('tr-TR', {day:'numeric', month:'short'});
}

function getTagColor(tagName) {
  const t = allTags.find(x => x.name === tagName);
  const hex = t ? t.color : '#0A84FF';
  // Convert hex to rgba for translucent pill
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return { bg: `rgba(${r},${g},${b},0.15)`, text: hex };
}

function setInboxFilter(filter) {
  currentInboxFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.filter-tab[data-filter="${filter}"]`).classList.add('active');
  renderConversationList();
}

function filterConversations() {
  renderConversationList();
}

function switchPromptTab(tab) {
  document.querySelectorAll('.prompt-editor-card .sheet-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-prompt-${tab}`).classList.add('active');
  document.getElementById('prompt-section-wp').style.display = tab === 'wp' ? 'block' : 'none';
  document.getElementById('prompt-section-tr').style.display = tab === 'tr' ? 'block' : 'none';
  document.getElementById('prompt-section-en').style.display = tab === 'en' ? 'block' : 'none';
}

function renderConversationList() {
  const list = cachedConversations;
  const search = (document.getElementById('inbox-search')?.value || '').toLowerCase();
  
  // Kanal sayaçları
  const counts = {all: list.length, whatsapp: 0, messenger: 0, instagram: 0};
  list.forEach(c => { const ch = c.last_channel || c.channel || 'whatsapp'; counts[ch] = (counts[ch]||0) + 1; });
  document.getElementById('count-all').textContent = counts.all;
  document.getElementById('count-whatsapp').textContent = counts.whatsapp;
  document.getElementById('count-messenger').textContent = counts.messenger;
  document.getElementById('count-instagram').textContent = counts.instagram;

  let filtered = currentInboxFilter === 'all' ? list : list.filter(c => (c.last_channel || c.channel || 'whatsapp') === currentInboxFilter);
  
  if (search) {
    filtered = filtered.filter(c => {
      const name = (c.patient_name || '').toLowerCase();
      const phone = (c.phone_number || '').toLowerCase();
      return name.includes(search) || phone.includes(search);
    });
  }

  document.getElementById('conversation-list').innerHTML = filtered.map(c => {
    const isActive = c.phone_number === currentPhone ? 'active' : '';
    
    // Status Badge (Bot vs Sen)
    const isHuman = c.status === 'human';
    const stBadge = isHuman ? '<span class="status-badge status-human">👤 Sen</span>' : '<span class="status-badge status-bot">🤖 Bot</span>';
    
    // 🎯 Birleşik Pipeline Badge (tek kaynak: lead_stage)
    // Bot fazından stage'i çıkar (eğer lead_stage yoksa)
    let effectiveStage = c.lead_stage || 'new';
    if (effectiveStage === 'new' || effectiveStage === 'responded') {
      // Bot fazından daha doğru stage belirle
      const phaseStage = BOT_PHASE_TO_STAGE[c.phase];
      if (phaseStage) effectiveStage = phaseStage;
    }
    // Sıcak lead override
    if (c.temperature === 'hot' && effectiveStage !== 'appointed') effectiveStage = 'hot_lead';
    if (isHuman && !['appointed', 'lost', 'hot_lead'].includes(effectiveStage)) effectiveStage = 'hot_lead';
    // Legacy uyumluluk
    if (effectiveStage === 'responded') effectiveStage = 'discovery';
    if (effectiveStage === 'appointment_request') effectiveStage = 'hot_lead';
    
    const stageBadge = getStageBadge(effectiveStage);

    const ch = c.last_channel || c.channel || 'whatsapp';
    const hasName = c.patient_name && c.patient_name !== c.phone_number;
    const isWhatsApp = ch === 'whatsapp';
    const isIG = ch === 'instagram';
    const isFB = ch === 'messenger';

    // İsim & telefon gösterimi kanalına göre farklılaşır
    let nameDisplay, phoneDisplay, profileLink = '';

    if (isWhatsApp) {
      // WhatsApp: gerçek telefon numarası + ülke bayrağı
      nameDisplay = hasName ? c.patient_name : c.phone_number;
      phoneDisplay = `<div class="contact-phone">🟢 ${countryBadge(c.phone_number)} ${c.phone_number}</div>`;
    } else if (isIG) {
      // Instagram: kullanıcı adı veya PSID'yi kısalt
      nameDisplay = hasName ? c.patient_name : `IG Kullanıcı`;
      const shortId = c.phone_number.length > 10 ? '...' + c.phone_number.slice(-6) : c.phone_number;
      phoneDisplay = hasName 
        ? `<div class="contact-phone">📸 Instagram</div>` 
        : `<div class="contact-phone">📸 ID: ${shortId}</div>`;
      // Instagram'da isim ile arama linki
      if (hasName) profileLink = `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(c.patient_name)}`;
    } else if (isFB) {
      // Messenger: FB ismi veya PSID kısaltması
      nameDisplay = hasName ? c.patient_name : `FB Kullanıcı`;
      const shortId = c.phone_number.length > 10 ? '...' + c.phone_number.slice(-6) : c.phone_number;
      phoneDisplay = hasName
        ? `<div class="contact-phone">💬 Facebook</div>`
        : `<div class="contact-phone">💬 ID: ${shortId}</div>`;
      // Facebook'ta isim ile arama linki
      if (hasName) profileLink = `https://www.facebook.com/search/people/?q=${encodeURIComponent(c.patient_name)}`;
    } else {
      nameDisplay = hasName ? c.patient_name : c.phone_number;
      phoneDisplay = `<div class="contact-phone">${c.phone_number}</div>`;
    }

    // Profil dış bağlantısı ikonu
    const profileLinkHtml = profileLink 
      ? `<a href="${profileLink}" target="_blank" onclick="event.stopPropagation()" style="font-size:11px; color:var(--accent-primary); text-decoration:none; opacity:0.8;" title="Profili Ara">🔍</a>` 
      : '';

    // Form badge (varsa)
    const formBadge = c.lead_form_name 
      ? `<span style="font-size:10px; background:rgba(191,90,242,0.12); color:#bf5af2; padding:1px 6px; border-radius:6px; white-space:nowrap;">${c.lead_form_name.substring(0, 25)}${c.lead_form_name.length > 25 ? '…' : ''}</span>` 
      : '';

    const timeDisplay = smartDate(c.last_message_at);
    const isRecent = (Date.now() - new Date(c.last_message_at).getTime()) < 300000;
    
    return `<div class="contact-item ${isActive}" onclick="loadChat('${c.phone_number}', '${ch}')">
      <div class="contact-avatar">${isRecent ? '<div class="online-dot"></div>' : ''}👤${getChannelIcon(ch)}</div>
      <div class="contact-info">
        <div class="contact-top">
          <span class="contact-name">${nameDisplay} ${profileLinkHtml}</span>
          <span class="contact-time">${timeDisplay}</span>
        </div>
        ${phoneDisplay}
        <div class="contact-preview">${c.last_message || ''}</div>
        <div class="contact-badges">${stageBadge}${stBadge}${formBadge ? ' ' + formBadge : ''}</div>
      </div>
    </div>`;
  }).join('') || '<div class="empty" style="padding:30px">Konuşma bulunamadı</div>';
}

/* KANBAN BOARD */
async function loadKanban() {
  const list = await api('conversations'); if(!list) return;
  
  // 🎯 Birleşik Pipeline Sütunları (pipeline-config.js'den)
  const cols = {};
  KANBAN_COLUMNS.forEach(col => { cols[col.key] = { ...col, cards: [] }; });

  list.forEach(c => {
    // Etkin stage'i belirle (inbox ile aynı mantık)
    let effectiveStage = c.lead_stage || 'new';
    if (effectiveStage === 'new' || effectiveStage === 'responded') {
      const phaseStage = BOT_PHASE_TO_STAGE[c.phase];
      if (phaseStage) effectiveStage = phaseStage;
    }
    if (c.temperature === 'hot' && effectiveStage !== 'appointed') effectiveStage = 'hot_lead';
    if (c.status === 'human' && !['appointed', 'lost', 'hot_lead'].includes(effectiveStage)) effectiveStage = 'hot_lead';
    if (effectiveStage === 'responded') effectiveStage = 'discovery';
    if (effectiveStage === 'appointment_request') effectiveStage = 'hot_lead';

    // Kaybedilenleri gösterme (kanban'da gizli)
    if (effectiveStage === 'lost') return;

    // Doğru sütuna yerleştir
    c._effectiveStage = effectiveStage;
    const targetCol = KANBAN_COLUMNS.find(col => col.stages.includes(effectiveStage));
    if (targetCol) {
      cols[targetCol.key].cards.push(c);
    } else {
      cols[KANBAN_COLUMNS[0].key].cards.push(c);
    }
  });

  const container = document.getElementById('kanban-container');
  container.innerHTML = Object.keys(cols).map(key => {
    const col = cols[key];
    
    return `
      <div class="kanban-col">
        <div class="kanban-header" style="border-bottom:2px solid ${col.color};">
          <span>${col.title}</span>
          <span class="count" style="background:${col.color}22; color:${col.color};">${col.cards.length}</span>
        </div>
        <div class="kanban-body">
          ${col.cards.map(c => {
            const hasName = c.patient_name && c.patient_name !== c.phone_number;
            const ch = c.last_channel || c.channel || 'whatsapp';
            const channelIcon = ch === 'whatsapp' ? '🟢' : (ch === 'instagram' ? '🟣' : '🔵');
            
            let displayName;
            let subInfo = '';
            if (ch === 'whatsapp') {
              displayName = hasName ? c.patient_name : c.phone_number;
              subInfo = countryBadge(c.phone_number) + ' ' + c.phone_number;
            } else if (ch === 'instagram') {
              displayName = hasName ? c.patient_name : 'IG Kullanıcı';
              subInfo = hasName ? `📸 @${c.patient_name.replace(/\\s/g, '').toLowerCase()}` : `📸 ID: ...${c.phone_number.slice(-6)}`;
            } else {
              displayName = hasName ? c.patient_name : 'FB Kullanıcı';
              subInfo = hasName ? '💬 Facebook' : `💬 ID: ...${c.phone_number.slice(-6)}`;
            }
            
            const preview = c.last_message || '...';
            const isHotCard = (c._effectiveStage === 'hot_lead');
            const cardStageBadge = getStageBadge(c._effectiveStage || 'new');
            
            return `
              <div class="kanban-card ${isHotCard ? 'hot' : ''}" onclick="openChatFromKanban('${c.phone_number}', '${ch}')">
                <div class="name">${channelIcon} ${displayName}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">${subInfo}</div>
                <div class="preview">${preview}</div>
                <div class="tags">
                  ${cardStageBadge}
                  ${c.lead_form_name ? `<span class="tag">${c.lead_form_name}</span>` : ''}
                  ${c.department ? `<span class="tag" style="background:rgba(10,132,255,0.2)">${c.department}</span>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

let kanbanChatPhone = '';
let kanbanChatChannel = '';

function openChatFromKanban(phone, channel) {
  openKanbanChat(phone, channel);
}

async function openKanbanChat(phone, channel) {
  kanbanChatPhone = phone;
  kanbanChatChannel = channel || 'whatsapp';
  
  // Panel ve overlay göster
  document.getElementById('kanban-chat-overlay').style.display = 'block';
  document.getElementById('kanban-chat-panel').style.display = 'flex';
  
  // Hasta bilgilerini yükle
  const pData = await api('get-patient&phone=' + phone);
  const hasName = pData.patient_name && pData.patient_name !== phone;
  const ch = channel || 'whatsapp';
  
  // Header bilgileri
  document.getElementById('kanban-chat-name').textContent = hasName ? pData.patient_name : (ch === 'instagram' ? 'IG Kullanıcı' : ch === 'messenger' ? 'FB Kullanıcı' : phone);
  
  let subText = '';
  if (ch === 'whatsapp') {
    const country = getCountry(phone);
    subText = country ? `${country.flag} ${country.name} · ${phone}` : phone;
  } else if (ch === 'instagram') {
    subText = hasName ? `📸 @${pData.patient_name.replace(/\s/g, '').toLowerCase()}` : `📸 ID: ...${phone.slice(-6)}`;
  } else {
    subText = hasName ? '💬 Facebook Messenger' : `💬 ID: ...${phone.slice(-6)}`;
  }
  document.getElementById('kanban-chat-sub').textContent = subText;
  document.getElementById('kanban-chat-channel-badge').innerHTML = getChannelBadge(ch);
  
  // Mesajları yükle
  document.getElementById('kanban-chat-messages').innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">⏳ Yükleniyor...</div>';
  
  const data = await api('conversation-detail&phone=' + phone);
  if (!data) return;
  const msgs = data.messages || data;
  const chatEl = document.getElementById('kanban-chat-messages');
  
  if (msgs.length === 0) {
    chatEl.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);">📭 Henüz mesaj yok</div>';
    return;
  }
  
  chatEl.innerHTML = msgs.map(m => {
    const isOut = m.direction === 'out';
    const isBot = m.model_used && m.model_used !== 'panel' && m.model_used !== 'toplu';
    const cls = `message-bubble ${isOut ? 'out' : 'in'} ${isOut && isBot ? 'bot-reply' : ''}`;
    const senderLabel = isOut ? (isBot ? '🤖 Bot' : '👤 Sen') : '📩 Hasta';
    const info = `<div class="msg-info">${senderLabel} · ${new Date(m.created_at).toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit'})} ${isBot ? '<span style="opacity:0.5">' + m.model_used + '</span>' : ''}</div>`;
    return `<div class="${cls}">${m.content}${info}</div>`;
  }).join('');
  chatEl.scrollTop = chatEl.scrollHeight;
  
  // Input'a focus
  setTimeout(() => document.getElementById('kanban-chat-input-field')?.focus(), 300);
}

function closeKanbanChat() {
  document.getElementById('kanban-chat-overlay').style.display = 'none';
  document.getElementById('kanban-chat-panel').style.display = 'none';
  kanbanChatPhone = '';
  kanbanChatChannel = '';
}

async function sendKanbanMessage() {
  const input = document.getElementById('kanban-chat-input-field');
  const msg = input.value.trim();
  if (!msg || !kanbanChatPhone) return;
  
  input.value = '';
  
  // Mesajı hemen UI'da göster
  const chatEl = document.getElementById('kanban-chat-messages');
  chatEl.innerHTML += `<div class="message-bubble out">${msg}<div class="msg-info">👤 Sen · şimdi</div></div>`;
  chatEl.scrollTop = chatEl.scrollHeight;
  
  // API ile gönder
  const result = await api('send-message', { phone: kanbanChatPhone, message: msg, channel: kanbanChatChannel });
  if (result?.success) {
    // Refresh messages
    setTimeout(() => openKanbanChat(kanbanChatPhone, kanbanChatChannel), 500);
  }
}

function openFullChat() {
  const phone = kanbanChatPhone;
  const channel = kanbanChatChannel;
  closeKanbanChat();
  document.querySelector('[data-page="conversations"]').click();
  setTimeout(() => {
    loadChat(phone, channel || 'whatsapp');
  }, 150);
}

/* OMNICHANNEL INBOX */
async function loadConversations() {
  const list = await api('conversations'); if(!list) return;
  allTags = await api('tags') || [];
  cachedConversations = list;
  renderConversationList();
}

async function loadChat(phone, channel) {
  currentPhone = phone; currentChannel = channel;
  
  // Highlight active
  document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
  const activeEl = Array.from(document.querySelectorAll('.contact-item')).find(el => el.innerHTML.includes(phone));
  if(activeEl) activeEl.classList.add('active');

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
  
  // CRM setup
  document.getElementById('crm-panel').style.display = 'flex';
  document.getElementById('crm-name').value = pData.patient_name || '';
  document.getElementById('crm-notes').value = pData.notes || '';
  
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
  chatEl.innerHTML = msgs.map(m => {
    const isOut = m.direction === 'out';
    const isBot = m.model_used && m.model_used !== 'panel' && m.model_used !== 'toplu';
    const cls = `message-bubble ${isOut ? 'out' : 'in'} ${isOut && isBot ? 'bot-reply' : ''}`;
    const senderLabel = isOut ? (isBot ? '🤖 Bot' : '👤 Sen') : '📩 Hasta';
    const info = `<div class="msg-info">${senderLabel} · ${new Date(m.created_at).toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit'})} ${isBot ? '<span class="bot-indicator">' + m.model_used + '</span>' : ''}</div>`;
    
    // Medya içerik kontrolü
    let content = m.content;
    if (m.media_url) {
      if (m.media_type === 'image') content = `<img src="${m.media_url}" style="max-width:240px;border-radius:8px;margin-bottom:4px;"><br>${m.content||''}`;
      else content = `📎 <a href="${m.media_url}" target="_blank" style="color:inherit;text-decoration:underline">${m.content||'Dosya'}</a>`;
    }
    return `<div class="${cls}">${content}${info}</div>`;
  }).join('');
  chatEl.scrollTop = chatEl.scrollHeight;
  
  // Form Geçmişi — CRM panelinde göster
  const formHistory = data.forms || [];
  const formBox = document.getElementById('crm-form-history');
  const formWrapper = document.getElementById('crm-form-history-wrapper');
  if (formBox && formWrapper) {
    if (formHistory.length > 0) {
      formBox.innerHTML = formHistory.map(f => {
        const dt = new Date(f.created_at).toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'});
        let tags = []; try { tags = JSON.parse(f.tags || '[]'); } catch(e) {}
        return `<div style="padding:8px 10px;background:var(--bg-hover);border-radius:6px;margin-bottom:6px;font-size:12px;border-left:3px solid var(--accent-primary);">
          <div style="font-weight:600;margin-bottom:3px;">📋 ${f.form_name || 'Genel Form'}</div>
          <div style="color:var(--text-muted);display:flex;gap:8px;flex-wrap:wrap;">
            <span>📅 ${dt}</span>
            ${f.city ? `<span>📍 ${f.city}</span>` : ''}
            ${tags.map(t => `<span style="background:var(--accent-primary);color:white;padding:1px 5px;border-radius:4px;font-size:10px;">${t}</span>`).join('')}
          </div>
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

/* DOSYA YÜKLEME */
let pendingFile = null;
async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file || !currentPhone) return;
  
  const maxSize = 16 * 1024 * 1024; // 16MB
  if (file.size > maxSize) { toast('Dosya 16MB\'dan büyük olamaz', 'error'); return; }
  
  const preview = document.getElementById('upload-preview');
  const isImage = file.type.startsWith('image/');
  
  if (isImage) {
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<div class="preview-card"><img src="${url}" style="max-height:80px;border-radius:6px;"><div><strong>${file.name}</strong><div style="font-size:11px;color:var(--text-muted)">${(file.size/1024).toFixed(0)} KB</div></div><button class="btn btn-sm btn-danger" onclick="cancelUpload()">✕</button></div>`;
  } else {
    preview.innerHTML = `<div class="preview-card"><span style="font-size:24px">📄</span><div><strong>${file.name}</strong><div style="font-size:11px;color:var(--text-muted)">${(file.size/1024).toFixed(0)} KB</div></div><button class="btn btn-sm btn-danger" onclick="cancelUpload()">✕</button></div>`;
  }
  preview.style.display = 'block';
  pendingFile = file;
}

function cancelUpload() {
  pendingFile = null;
  document.getElementById('upload-preview').style.display = 'none';
  document.getElementById('file-upload').value = '';
}

async function sendFileMessage() {
  if (!pendingFile || !currentPhone) return;
  
  toast('Dosya hazırlanıyor...');
  
  // Dosyayı base64'e çevir
  const reader = new FileReader();
  reader.onload = async function() {
    try {
      toast('Dosya gönderiliyor...');
      const r = await fetch('/api/upload-media', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + AUTH_TOKEN 
        },
        body: JSON.stringify({
          phone: currentPhone,
          channel: currentChannel,
          caption: document.getElementById('chat-input').value || '',
          fileName: pendingFile.name,
          fileType: pendingFile.type,
          fileBase64: reader.result
        })
      });
      const data = await r.json();
      if (data.success) { toast('Dosya gönderildi ✅'); loadChat(currentPhone, currentChannel); }
      else toast('Dosya gönderilemedi: ' + (data.error||''), 'error');
    } catch(e) { toast('Dosya hatası: ' + e.message, 'error'); }
    cancelUpload();
    document.getElementById('chat-input').value = '';
  };
  reader.readAsDataURL(pendingFile);
}

async function instantStageUpdate(newStage) {
  if(!currentPhone) return;
  // Anında lokal cache'i güncelle (Hızlı UI tepkisi)
  const idx = cachedConversations.findIndex(c => c.phone_number === currentPhone);
  if (idx > -1) cachedConversations[idx].lead_stage = newStage;
  
  renderConversationList(); // Sol listeyi anında güncelle
  
  if (currentPage === 'page-kanban') {
    loadKanban(); // Kanban açıksa anında yer değiştirsin
  }

  // Arkada sessizce kaydet
  await api('update-patient', 'POST', {
    phone: currentPhone,
    lead_stage: newStage
  });
}

async function autoSaveCRM() {
  if(!currentPhone) return;

  const newName = document.getElementById('crm-name').value;
  const newNotes = document.getElementById('crm-notes').value;
  const newDepartment = document.getElementById('crm-department').value;
  const newStage = document.getElementById('crm-stage').value;

  const payload = {
    phone: currentPhone, 
    patient_name: newName, 
    tags: "[]",
    notes: newNotes,
    department: newDepartment,
    patient_type: 'Yerli', // Hardcoded as obsolete, API still expects it maybe
    lead_stage: newStage
  };

  // Lokal listeyi anında güncelle
  const idx = cachedConversations.findIndex(c => c.phone_number === currentPhone);
  if (idx > -1) {
    cachedConversations[idx].patient_name = newName;
    cachedConversations[idx].notes = newNotes;
    cachedConversations[idx].department = newDepartment;
  }
  
  // Listeyi sessizce render et (Arama/Filtre bozulmadan isim değişikliğini yansıtmak için)
  renderConversationList();

  // API'ye kaydet
  try {
    await api('update-patient', 'POST', payload);
    toast('✓ Kaydedildi', 'success');
  } catch(e) {
    console.error('AutoSave Error', e);
  }
}

async function setConvStatus(s) {
  if(!currentPhone) return;
  await api('conversation-status','POST',{phone:currentPhone, status:s});
  document.getElementById('btn-status-bot').className = `handover-btn ${s==='active' ? 'active-bot' : ''}`;
  document.getElementById('btn-status-human').className = `handover-btn ${s==='human' ? 'active-human' : ''}`;
  toast(s==='human'?'Manuel kontrole geçildi':'Yapay Zeka devrede');
  loadConversations();
}

async function deleteMessages() {
  if(!currentPhone || !confirm('Tüm geçmiş silinecek. Onaylıyor musunuz?')) return;
  await api('delete-messages','POST',{phone:currentPhone});
  toast('Sohbet temizlendi');
  document.getElementById('chat-messages').innerHTML = '<div class="empty">Sohbet temizlendi.</div>';
}

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

/* BOT EĞİTİMİ */
async function loadPrompt() {
  const s = await api('settings'); 
  if(s) {
    document.getElementById('prompt-editor-wp').value = s.system_prompt_whatsapp || s.system_prompt || '';
    document.getElementById('prompt-editor-tr').value = s.system_prompt_tr || s.system_prompt || '';
    document.getElementById('prompt-editor-en').value = s.system_prompt_foreign || '';
    document.getElementById('foreign-page-id').value = s.foreign_page_id || '';
  }
}
async function savePrompt() {
  await api('settings','POST',{key:'system_prompt_whatsapp', value:document.getElementById('prompt-editor-wp').value});
  await api('settings','POST',{key:'system_prompt_tr', value:document.getElementById('prompt-editor-tr').value});
  await api('settings','POST',{key:'system_prompt_foreign', value:document.getElementById('prompt-editor-en').value});
  await api('settings','POST',{key:'foreign_page_id', value:document.getElementById('foreign-page-id').value});
  toast('Sistem Promptları güncellendi!');
}
async function resetPrompt() {
  if(!confirm('Orijinal (Başkent Hastanesi) ayarlara dönülecek. Emin misiniz?')) return;
  const d = await api('default-prompt');
  if(d) { 
    document.getElementById('prompt-editor-wp').value = d.wp || ''; 
    document.getElementById('prompt-editor-tr').value = d.tr || ''; 
    document.getElementById('prompt-editor-en').value = d.en || ''; 
    toast('Varsayılan metinler yüklendi! Kalıcı olması için KAYDET butonuna basın.');
  }
}

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

function openLeadDetail(sortedIndex) {
  // Sıralanmış index'ten orijinal satıra dönüş
  const rowIndex = window._sortedRowMap ? window._sortedRowMap[sortedIndex] : sortedIndex;
  const headers = window._sheetHeaders;
  const row = window._sheetRows[rowIndex];
  if (!headers || !row) return;

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
  const normalizePhone = (p) => p.replace(/[\s\-().]/g, '');
  const seenPhones = new Set();

  if (phoneVal) {
    const clean = normalizePhone(phoneVal);
    seenPhones.add(clean);
    phoneNumbers.push({ number: clean, label: 'WhatsApp', isWhatsApp: true, raw: phoneVal });
  }

  // SADECE açıkça telefon/whatsapp olarak adlandırılmış alanlardan numara al
  // (Meta reklam ID'lerini yakalamayı engeller)
  headers.forEach((h, j) => {
    if (j === phoneCol || j === nameCol || j === emailCol) return;
    const val = row[j] || '';
    const lower = h.toLowerCase().replace(/[\s_]+/g, '');
    const isWA = lower.includes('whatsapp') || lower.includes('wp') || lower.includes('wapp');
    const isPhoneField = isWA || lower.includes('telefon') || lower === 'phone' || lower === 'phonenumber' || lower.includes('numara') || lower.includes('gsm') || lower.includes('cep') || lower.includes('iletişim') || lower.includes('iletisim');
    // SADECE telefon/whatsapp alanlarından numara çıkar
    if (!isPhoneField) return;
    const matches = val.match(phoneRegex);
    if (matches) {
      matches.forEach(m => {
        const clean = normalizePhone(m);
        if (clean.length >= 10 && !seenPhones.has(clean)) {
          seenPhones.add(clean);
          phoneNumbers.push({ number: clean, label: isWA ? 'WhatsApp' : 'Telefon', isWhatsApp: isWA, raw: m.trim() });
        }
      });
    }
  });

  if (phoneVal) {
    let readLeads = JSON.parse(localStorage.getItem('readLeads') || '[]');
    if (!readLeads.includes(phoneVal)) { readLeads.push(phoneVal); localStorage.setItem('readLeads', JSON.stringify(readLeads)); }
  }

  const phonesHtml = phoneNumbers.length > 0 ? phoneNumbers.map(p => `
    <div style="display:flex; align-items:center; gap:8px; padding:6px 0;">
      <div style="flex:1;">
        <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase;">WHATSAPP</div>
        <div style="font-size:15px; color:#25D366; font-weight:500; display:flex; align-items:center; gap:6px;">
          🟢 ${p.raw} ${countryBadge(p.number)}
        </div>
      </div>
      <a href="https://wa.me/${p.number}" target="_blank" style="background:#25D366; color:white; border:none; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:600; text-decoration:none; white-space:nowrap;">WA Yaz</a>
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
            <a href="https://wa.me/${primaryPhone}" target="_blank" class="btn" style="background:#25D366; color:white; border:none; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:600; text-decoration:none;">
              🟢 WhatsApp'tan Yaz
            </a>
            <button onclick="triggerSingleOutbound('${primaryPhone}', '${nameVal.replace(/'/g, "\\'")}')" class="btn" style="background:#bf5af2; color:white; border:none; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:600;">
              🤖 Bota Devret (Açılış Mesajı)
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
    if (lower.includes('lead_status') || lower === 'status' || lower === 'durum') { statusColIndex = j; return; }
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

        <!-- 🤖 Bot Durumu & Kontrol -->
        <div id="fd-bot-status-card" style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:12px; padding:20px;">
          <h3 style="margin:0 0 12px 0; font-size:14px; color:white; display:flex; align-items:center; gap:8px;">
            🤖 Bot Durumu
          </h3>
          <div id="fd-bot-status-content" style="display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; align-items:center; gap:8px; padding:10px 14px; border-radius:8px; background:rgba(255,255,255,0.05);">
              <span id="fd-bot-indicator" style="width:10px; height:10px; border-radius:50%; background:#6b7280;"></span>
              <span id="fd-bot-label" style="font-size:13px; color:var(--text-muted);">Yükleniyor...</span>
            </div>
            <div id="fd-bot-phase" style="font-size:11px; color:var(--text-muted); padding:0 4px;"></div>
            <div style="display:flex; gap:6px;">
              <button id="fd-btn-bot" onclick="fdToggleBotStatus('${cleanPhone}', 'active')" style="flex:1; padding:8px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:white; cursor:pointer; font-size:12px; font-weight:500; transition:all 0.2s;">
                🤖 Bot Aktif
              </button>
              <button id="fd-btn-human" onclick="fdToggleBotStatus('${cleanPhone}', 'human')" style="flex:1; padding:8px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:white; cursor:pointer; font-size:12px; font-weight:500; transition:all 0.2s;">
                👤 Manuel Devral
              </button>
            </div>
            <button onclick="fdSendWelcome('${cleanPhone}')" style="width:100%; padding:8px; border-radius:8px; border:1px solid rgba(48,209,88,0.3); background:rgba(48,209,88,0.08); color:#30D158; cursor:pointer; font-size:12px; font-weight:500; transition:all 0.2s;">
              📩 Açılış Mesajı Gönder
            </button>
          </div>
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
  document.getElementById('page-form-management').style.display = 'none';
  document.getElementById('page-form-detail').style.display = 'flex';

  // Async: DB'den CRM verisini yükle (etiketler vb.)
  loadFormDetailCRM(cleanPhone);
}

// Form detay CRM verisini DB'den yükle
async function loadFormDetailCRM(phone) {
  if (!phone) return;
  try {
    const pData = await api('get-patient&phone=' + phone);
    
    // Pipeline durumunu DB'den kontrol et
    if (pData.lead_stage && pData.lead_stage !== 'new') {
      document.querySelectorAll('.fd-stage-btn').forEach(btn => {
        const stage = btn.dataset.stage;
        const sCfg = PIPELINE_STAGES[stage] || PIPELINE_STAGES.new;
        if (stage === pData.lead_stage) {
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
      const dbCfg = PIPELINE_STAGES[pData.lead_stage] || { emoji: '❓', label: pData.lead_stage };
      if (infoEl) infoEl.innerHTML = `DB durumu: <strong>${dbCfg.emoji} ${dbCfg.label}</strong>`;
    }
    
    // 🤖 Bot Durumu güncelle
    const isHuman = pData.status === 'human';
    const botIndicator = document.getElementById('fd-bot-indicator');
    const botLabel = document.getElementById('fd-bot-label');
    const botPhase = document.getElementById('fd-bot-phase');
    const btnBot = document.getElementById('fd-btn-bot');
    const btnHuman = document.getElementById('fd-btn-human');
    
    if (botIndicator) {
      if (isHuman) {
        botIndicator.style.background = '#FF9F0A';
        botLabel.textContent = '👤 Manuel Kontrol — Bot durdu';
        botLabel.style.color = '#FF9F0A';
      } else {
        botIndicator.style.background = '#30D158';
        botLabel.textContent = '🤖 Bot Aktif — Otomatik yanıt veriyor';
        botLabel.style.color = '#30D158';
      }
    }
    
    if (botPhase) {
      const phaseLabels = {
        greeting: '📍 Faz: Karşılama — Şikayeti dinliyor',
        discovery: '📍 Faz: Analiz — Tetkik/MR istiyor',
        trust: '📍 Faz: İkna — Güven oluşturuyor',
        handover: '📍 Faz: Devir — Randevu bekliyor!'
      };
      botPhase.textContent = phaseLabels[pData.phase] || '📍 Faz: Başlangıç';
      if (pData.phase === 'handover') {
        botPhase.style.color = '#FF453A';
        botPhase.style.fontWeight = '600';
      }
    }
    
    if (btnBot) {
      btnBot.style.background = !isHuman ? 'rgba(48,209,88,0.15)' : 'var(--bg-hover)';
      btnBot.style.borderColor = !isHuman ? '#30D158' : 'var(--border-color)';
      btnHuman.style.background = isHuman ? 'rgba(255,159,10,0.15)' : 'var(--bg-hover)';
      btnHuman.style.borderColor = isHuman ? '#FF9F0A' : 'var(--border-color)';
    }
    
    // CRM etiketleri yükle
    let currentTags = [];
    try { currentTags = JSON.parse(pData.tags || '[]'); } catch(e) {}
    renderFormDetailTags(phone, pData.patient_name || '', currentTags);
    
  } catch(e) {
    console.error('CRM yükleme hatası:', e);
  }
}

// Bot durumunu form detayından toggle et
async function fdToggleBotStatus(phone, newStatus) {
  try {
    await api('update-patient', 'POST', { phone, status: newStatus });
    toast(newStatus === 'human' ? '👤 Manuel kontrole geçildi' : '🤖 Bot tekrar aktif');
    // UI güncelle
    loadFormDetailCRM(phone);
  } catch(e) {
    toast('Hata oluştu', 'error');
  }
}

// Form detayından açılış mesajı gönder
async function fdSendWelcome(phone) {
  if (!phone) return toast('Telefon numarası yok', 'error');
  try {
    const result = await api('send-message', 'POST', { phone, message: '__welcome__', channel: 'whatsapp' });
    if (result?.success) {
      toast('📩 Açılış mesajı gönderildi');
    } else {
      toast('Gönderilemedi', 'error');
    }
  } catch(e) {
    toast('Gönderim hatası', 'error');
  }
}

// Pipeline durumu değiştir — DB + Sheets'e birlikte yaz
async function setLeadPipelineStage(phone, name, stage, btnEl, sheetsStatusCol, sheetsRowIndex) {
  if (!phone) return toast('Telefon numarası bulunamadı', 'error');
  
  // 🎯 Birleşik config'den oku
  const cfg = PIPELINE_STAGES[stage] || PIPELINE_STAGES.new;
  
  document.querySelectorAll('.fd-stage-btn').forEach(btn => {
    btn.style.background = 'var(--bg-hover)';
    btn.style.borderColor = 'var(--border-color)';
    btn.style.fontWeight = '500';
  });
  btnEl.style.background = cfg.color + '22';
  btnEl.style.borderColor = cfg.color;
  btnEl.style.fontWeight = '700';

  const infoEl = document.getElementById('fd-pipeline-info');
  if (infoEl) {
    infoEl.innerHTML = `⏳ Kaydediliyor...`;
  }
  
  try {
    // 1. DB'ye kaydet (conversations + leads + events otomatik)
    await api('update-patient', 'POST', {
      phone: phone,
      patient_name: name || null,
      lead_stage: stage
    });
    
    // 2. Google Sheets'e kaydet (status sütunu varsa)
    if (sheetsStatusCol > -1 && sheetsRowIndex >= 0) {
      const sheetsValue = cfg.sheetsVal || stage;
      await updateSheetCell(sheetsRowIndex, sheetsStatusCol, sheetsValue);
    }
    
    if (infoEl) {
      infoEl.innerHTML = `✅ <strong>${cfg.emoji} ${cfg.label}</strong> — DB + Sheets kaydedildi`;
      if (stage === 'appointed') infoEl.innerHTML += '<br>🗓️ Randevu Talepleri paneline eklendi';
    }
    toast(`${cfg.emoji} ${cfg.label}`);
  } catch(e) {
    toast('Kayıt hatası', 'error');
    if (infoEl) infoEl.innerHTML = '❌ Kayıt hatası';
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
  toast(`🏷️ "${tagName}" eklendi`);
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
  toast(`🏷️ "${tagName}" kaldırıldı`);
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
    const resp = await fetch('/api/bulk-outbound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        leads: [{ phone, name }],
        sheetContext: { sheetName: window._activeSheet }
      })
    });
    const data = await resp.json();
    
    if (data.success && data.results.successes.length > 0) {
      toast('✅ Mesaj başarıyla gönderildi ve bot başlatıldı!');
    } else {
      toast('❌ Mesaj gönderilemedi: ' + (data.results?.failures[0]?.error || 'Bilinmeyen hata'), 'error');
    }
  } catch (error) {
    toast('Sunucu hatası', 'error');
  }
}
function goBackToForms() {
  document.getElementById('page-form-detail').style.display = 'none';
  document.getElementById('page-form-management').style.display = 'flex';
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

/* ŞABLONLAR */
async function loadTemplates(){const list=await api('templates');if(!list)return;document.getElementById('template-list').innerHTML=list.map(t=>`<div style="padding:16px; background:var(--bg-hover); border-radius:var(--radius-sm); margin-bottom:8px;"><div style="display:flex; justify-content:space-between; margin-bottom:8px;"><strong>${t.title}</strong><button class="btn-sm btn-danger" onclick="deleteTemplate(${t.id})">Sil</button></div><div style="font-size:13px; color:var(--text-muted);">${t.content}</div></div>`).join('')||'<p class="empty">Şablon yok</p>'}
async function addTemplate(){const t=document.getElementById('tpl-title').value,c=document.getElementById('tpl-content').value,cat=document.getElementById('tpl-category').value;if(!t||!c)return toast('Zorunlu alanlar','error');await api('templates','POST',{title:t,content:c,category:cat});document.getElementById('tpl-title').value='';document.getElementById('tpl-content').value='';loadTemplates();toast('Eklendi')}
async function deleteTemplate(id){if(!confirm('Silinsin mi?'))return;await api('templates&id='+id,'DELETE');loadTemplates();toast('Silindi')}

/* ANALİTİK */
async function loadAnalytics(){const d=await api('analytics');if(!d)return;const mx=Math.max(...(d.daily||[]).map(x=>+x.count),1);document.getElementById('chart-daily').innerHTML=(d.daily||[]).map(x=>`<div style="display:flex; flex-direction:column; align-items:center; flex:1; height:100%; justify-content:flex-end;"><div style="background:var(--accent-primary); width:100%; max-width:30px; height:${+x.count/mx*100}%; border-radius:4px 4px 0 0; position:relative;"><span style="position:absolute; top:-20px; font-size:10px; width:100%; text-align:center;">${x.count}</span></div><div style="font-size:10px; margin-top:8px; color:var(--text-muted);">${new Date(x.date).toLocaleDateString('tr-TR',{weekday:'short'})}</div></div>`).join('')||'<p class="empty">Veri yok</p>';const mh=Math.max(...(d.hourly||[]).map(x=>+x.count),1);document.getElementById('chart-hourly').innerHTML=(d.hourly||[]).map(x=>`<div style="display:flex; flex-direction:column; align-items:center; flex:1; height:100%; justify-content:flex-end;"><div style="background:#10b981; width:100%; max-width:30px; height:${+x.count/mh*100}%; border-radius:4px 4px 0 0; position:relative;"><span style="position:absolute; top:-20px; font-size:10px; width:100%; text-align:center;">${x.count}</span></div><div style="font-size:10px; margin-top:8px; color:var(--text-muted);">${x.hour}:00</div></div>`).join('')||'<p class="empty">Veri yok</p>';document.getElementById('top-phones').innerHTML=(d.topPhones||[]).map((p,i)=>`<div style="display:flex; justify-content:space-between; padding:12px; background:var(--bg-hover); margin-bottom:4px; border-radius:6px;"><span>#${i+1} 📱 ${p.phone_number}</span><span style="color:var(--text-muted);">${p.count} mesaj</span></div>`).join('');document.getElementById('model-usage').innerHTML=(d.modelUsage||[]).map(m=>`<div style="display:flex; justify-content:space-between; padding:12px; background:var(--bg-hover); margin-bottom:4px; border-radius:6px;"><span>🤖 ${m.model_used}</span><span style="color:var(--text-muted);">${m.count}</span></div>`).join('');loadAdvancedAnalytics();}


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

function switchAptTab(tab) {
  document.querySelectorAll('.sheet-tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-apt-' + tab).classList.add('active');
  document.getElementById('apt-view-inbox').style.display = tab === 'inbox' ? 'block' : 'none';
  document.getElementById('apt-view-calendar').style.display = tab === 'calendar' ? 'block' : 'none';
  if (tab === 'calendar') filterCalendar();
}

async function loadAppointments() {
  const data = await api('appointments');
  if (!data) return;
  calendarEventsData = data.events || [];
  
  // INBOX VERİLERİ (Takvime eklenmemiş veya iptal olmuş hastalar)
  const inboxEvents = calendarEventsData.filter(e => e.status !== 'scheduled' && e.status !== 'confirmed');
  
  document.getElementById('apt-pending').textContent = inboxEvents.filter(e => e.status === 'pending').length;
  document.getElementById('apt-called').textContent = inboxEvents.filter(e => e.status === 'called').length;
  document.getElementById('apt-lost').textContent = inboxEvents.filter(e => e.status === 'lost' || e.status === 'cancelled').length;
  
  const badge = document.getElementById('apt-badge');
  const pendingCount = inboxEvents.filter(e => e.status === 'pending').length;
  if (pendingCount > 0) { badge.textContent = pendingCount; badge.style.display = 'inline'; }
  else { badge.style.display = 'none'; }
  
  const list = document.getElementById('appointment-list');
  if (inboxEvents.length === 0) { list.innerHTML = '<div class="empty" style="padding:30px"><div class="empty-icon">📥</div>Henüz gelen kutusunda talep yok</div>'; }
  else {
    const sC = { pending:'#f59e0b', called:'#3b82f6', lost:'#6b7280', cancelled:'#6b7280' };
    const sL = { pending:'⏳ Bekliyor', called:'📞 Ön Görüşme Yapıldı', lost:'❌ Olumsuz', cancelled:'🚫 İptal' };
    list.innerHTML = inboxEvents.map(e => {
      const nm = e.patient_name || e.phone_number;
      const dt = new Date(e.created_at).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--bg-hover);border-radius:var(--radius-sm);margin-bottom:8px;border-left:3px solid ${sC[e.status]||'#6b7280'}">
        <div style="flex:1"><div style="font-weight:600;margin-bottom:4px;display:flex;align-items:center;gap:8px;">${nm} ${e.patient_type==='Gurbetçi'?'🌍':(e.patient_type==='Yabancı Turist'?'✈️':'🇹🇷')}</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap">${e.department?`<span style="font-size:11px;background:var(--accent-primary);color:white;padding:2px 6px;border-radius:6px;font-weight:500;">🩺 ${e.department}</span>`:''}${e.form_name?'<span style="font-size:11px;color:var(--text-muted)">📋 '+e.form_name+'</span>':''}${e.city?'<span style="font-size:11px;color:var(--text-muted)">📍 '+e.city+'</span>':''}<span style="font-size:11px;color:var(--text-muted)">🕐 ${dt}</span></div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.details||''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span style="background:${sC[e.status]||'#6b7280'}20;color:${sC[e.status]||'#6b7280'};padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600">${sL[e.status]||e.status}</span>
          <select onchange="updateAppointment(${e.id},this.value)" style="background:var(--bg-card);color:var(--text-main);border:1px solid var(--border-color);border-radius:6px;padding:4px 8px;font-size:12px">
            <option value="" disabled ${e.status === 'pending' ? 'selected' : ''}>Durum Güncelle</option>
            <option value="called" ${e.status === 'called' ? 'selected' : ''}>📞 Ön Görüşme</option>
            <option value="lost" ${e.status === 'lost' ? 'selected' : ''}>❌ Olumsuz</option>
          </select>
          <button class="btn btn-sm btn-primary" onclick="openScheduleModal(${e.id})" style="font-size:11px;padding:4px 8px;background:#22c55e;border-color:#22c55e;">🗓️ Takvime Ekle</button>
          <button class="btn btn-sm btn-secondary" onclick="document.querySelector('[data-page=conversations]').click();setTimeout(()=>loadChat('${e.phone_number}','whatsapp'),300)" style="font-size:11px;padding:4px 8px">💬</button>
        </div></div>`;
    }).join('');
  }
  
  filterCalendar(); // Takvimi de yenile
}

function openScheduleModal(id) {
  document.getElementById('sch-apt-id').value = id;
  document.getElementById('sch-date').value = '';
  document.getElementById('sch-doctor').value = '';
  document.getElementById('modal-schedule').style.display = 'flex';
}

async function submitSchedule() {
  const id = document.getElementById('sch-apt-id').value;
  const date = document.getElementById('sch-date').value;
  const doctor = document.getElementById('sch-doctor').value;
  if (!date) return toast('Lütfen tarih seçin!', 'error');
  
  await api('update-appointment','POST',{id, status: 'scheduled', scheduled_date: date, assigned_doctor: doctor});
  document.getElementById('modal-schedule').style.display = 'none';
  toast('Takvime eklendi ✅');
  loadAppointments();
  switchAptTab('calendar');
}

function filterCalendar() {
  const q = (document.getElementById('calendar-search').value || '').toLowerCase();
  const dateStr = document.getElementById('calendar-date-picker').value; // YYYY-MM-DD
  
  // Sadece takvimlenmiş randevular
  let cal = calendarEventsData.filter(e => e.status === 'scheduled' || e.status === 'confirmed');
  
  if (dateStr) {
    cal = cal.filter(e => e.scheduled_date && e.scheduled_date.startsWith(dateStr));
    document.getElementById('calendar-day-title').textContent = new Date(dateStr).toLocaleDateString('tr-TR', {weekday:'long', day:'numeric', month:'long'}) + ' Randevuları';
  } else {
    document.getElementById('calendar-day-title').textContent = 'Tüm Gelecek Randevular';
  }
  
  if (q) {
    cal = cal.filter(e => (e.patient_name||'').toLowerCase().includes(q) || (e.phone_number||'').includes(q) || (e.department||'').toLowerCase().includes(q));
  }
  
  // Tarihe göre sırala
  cal.sort((a,b) => new Date(a.scheduled_date) - new Date(b.scheduled_date));
  
  document.getElementById('apt-scheduled').textContent = cal.length;
  
  const list = document.getElementById('calendar-list');
  if (cal.length === 0) { list.innerHTML = '<div class="empty"><div class="empty-icon">🗓️</div>Bu kriterlere uygun takvimli randevu yok</div>'; return; }
  
  list.innerHTML = cal.map(e => {
    const nm = e.patient_name || e.phone_number;
    const timeStr = e.scheduled_date ? new Date(e.scheduled_date).toLocaleString('tr-TR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Belirsiz';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:16px;background:var(--bg-hover);border-radius:var(--radius-sm);margin-bottom:8px;border-left:4px solid #22c55e">
      <div style="flex:1"><div style="font-weight:600;margin-bottom:6px;font-size:15px;display:flex;align-items:center;gap:8px;">${nm} ${e.patient_type==='Gurbetçi'?'🌍':(e.patient_type==='Yabancı Turist'?'✈️':'🇹🇷')}</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <span style="color:#22c55e;font-weight:600;font-size:13px;">🕒 ${timeStr}</span>
          ${e.assigned_doctor ? `<span style="font-size:13px;color:var(--text-main);">👨‍⚕️ ${e.assigned_doctor}</span>` : ''}
          ${e.department ? `<span style="font-size:12px;background:var(--accent-primary);color:white;padding:2px 8px;border-radius:6px;font-weight:500;">🩺 ${e.department}</span>`:''}
        </div>
        ${e.details ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;">${e.details}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-direction:column;">
        <select onchange="updateAppointment(${e.id},this.value)" style="background:var(--bg-card);color:var(--text-main);border:1px solid var(--border-color);border-radius:6px;padding:4px 8px;font-size:12px">
           <option value="">Durum Güncelle</option>
           <option value="confirmed">✅ Tedavi Onaylandı</option>
           <option value="noshow">❌ Randevuya Gelmedi</option>
           <option value="cancelled">🚫 İptal Etti</option>
        </select>
        <button class="btn btn-sm btn-secondary" onclick="document.querySelector('[data-page=conversations]').click();setTimeout(()=>loadChat('${e.phone_number}','whatsapp'),300)" style="font-size:11px;padding:4px 8px;width:100%">💬 Sohbet</button>
      </div></div>`;
  }).join('');
}

async function updateAppointment(id,status) { if(!status)return; await api('update-appointment','POST',{id,status}); loadAppointments(); toast('Randevu durumu güncellendi ✅'); }

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
  if (page === 'page-dashboard') loadDashboard();
  if (page === 'page-kanban') loadKanban();
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
    
    let container = document.getElementById('zorbay-alerts-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'zorbay-alerts-container';
      container.className = 'zorbay-alert-container';
      document.body.appendChild(container);
    }
    
    // Yalnızca ekranda olmayanları ekle
    alerts.forEach(alert => {
      if (document.getElementById('zorbay-alert-' + alert.id)) return;
      
      const el = document.createElement('div');
      el.id = 'zorbay-alert-' + alert.id;
      el.className = 'zorbay-alert';
      el.innerHTML = `
        <div class="icon">🚨</div>
        <div class="text">${alert.message}</div>
        <button class="close-btn" onclick="dismissZorbayAlert(${alert.id}, '${alert.phone_number}')">✕</button>
      `;
      // Tıklanınca o sohbete git
      el.onclick = (e) => {
        if (e.target.className === 'close-btn') return;
        document.querySelector('[data-page="conversations"]').click();
        loadChat(alert.phone_number, 'whatsapp');
        dismissZorbayAlert(alert.id, alert.phone_number);
      };
      
      container.appendChild(el);
      
      // Sesi çal (Kullanıcı etkileşimi olduysa çalar)
      try { new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play(); } catch(e){}
    });
  } catch (e) { console.error('Alert fetch error', e); }
}

async function dismissZorbayAlert(id, phone) {
  const el = document.getElementById('zorbay-alert-' + id);
  if (el) el.remove();
  await api('mark-alert-read', 'POST', { id });
}

