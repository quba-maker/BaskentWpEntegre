const API = '/api/panel'; 
let AUTH_TOKEN = localStorage.getItem('panel_auth') || ''; 
let currentPhone = ''; 
let currentChannel = 'whatsapp';
let allTags = [];

// 🔒 XSS Koruması — tüm user-input'ları escape et
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// 🔒 Session Expiry — 24 saat sonra otomatik logout
(function checkSessionExpiry() {
  const loginTime = localStorage.getItem('panel_login_time');
  if (loginTime && Date.now() - parseInt(loginTime) > 24 * 60 * 60 * 1000) {
    localStorage.removeItem('panel_auth');
    localStorage.removeItem('panel_login_time');
    AUTH_TOKEN = '';
  }
})();

// 🔀 Resizable Panels — Sürükle/Bırak ile panel genişliği ayarlama
document.addEventListener('DOMContentLoaded', () => {
  // Mobilde resize panel mantığını atla
  if (window.innerWidth > 768) {
    const savedLeft = localStorage.getItem('inbox_left_w');
    const savedRight = localStorage.getItem('inbox_right_w');
    if (savedLeft) document.documentElement.style.setProperty('--inbox-left-w', savedLeft + 'px');
    if (savedRight) document.documentElement.style.setProperty('--inbox-right-w', savedRight + 'px');
    initResizeHandle('resize-left', '.inbox-sidebar', 'left');
    initResizeHandle('resize-right', '.inbox-details', 'right');
  }
});

function initResizeHandle(handleId, panelSelector, side) {
  const handle = document.getElementById(handleId);
  if (!handle) return;
  
  let isDragging = false;
  let startX = 0;
  let startWidth = 0;
  
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    startX = e.clientX;
    const panel = document.querySelector(panelSelector);
    if (!panel) return;
    startWidth = panel.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const delta = side === 'left' ? (e.clientX - startX) : (startX - e.clientX);
    const newWidth = Math.max(220, Math.min(500, startWidth + delta));
    const cssVar = side === 'left' ? '--inbox-left-w' : '--inbox-right-w';
    document.documentElement.style.setProperty(cssVar, newWidth + 'px');
  });
  
  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Persist
    const panel = document.querySelector(panelSelector);
    if (panel) {
      const key = side === 'left' ? 'inbox_left_w' : 'inbox_right_w';
      localStorage.setItem(key, panel.offsetWidth);
    }
  });
}

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

function doLogin() { AUTH_TOKEN = document.getElementById('login-pass').value; localStorage.setItem('panel_auth', AUTH_TOKEN); localStorage.setItem('panel_login_time', String(Date.now())); checkAuth(); }
async function checkAuth() {
  try {
    const r = await fetch(API+'?action=dashboard', {headers:{Authorization:'Bearer '+AUTH_TOKEN}});
    if(r.ok) { 
      document.getElementById('login-screen').style.display='none'; 
      document.getElementById('main-app').style.display='flex'; 
      loadCommandCenter(); 
      startPolling(); // SWR Polling başlat
    }
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
    
    // Form management'a dönüşte detay sayfasını kapatıp listeyi göster
    if (b.dataset.page === 'form-management') {
      document.getElementById('page-form-detail').style.display = 'none';
      document.getElementById('page-form-management').style.display = 'block';
    }
    
    // Yükleme fonksiyonları
    ({'command-center':loadCommandCenter, kanban:loadKanban, leads:loadSheets, conversations:loadConversations, training:loadPrompt, templates:loadTemplates, settings:loadSettings, appointments:loadAppointments, 'form-management':loadFormManagement})[b.dataset.page]?.();
    // Mobilde sidebar'ı kapat
    document.getElementById('sidebar')?.classList.remove('open');
  });
});

// ========== BİLDİRİM SİSTEMİ ==========
const _notifStore = {
  _key: 'crm_notifications',
  _dedup: new Set(),
  _max: 50,
  getAll() { try { return JSON.parse(localStorage.getItem(this._key) || '[]'); } catch { return []; } },
  save(list) { localStorage.setItem(this._key, JSON.stringify(list.slice(0, this._max))); },
  add(notif) {
    // Deduplikasyon: aynı mesaj son 60 saniye içinde tekrar gelmesin
    const dedupKey = notif.title + notif.desc;
    if (this._dedup.has(dedupKey)) return false;
    this._dedup.add(dedupKey);
    setTimeout(() => this._dedup.delete(dedupKey), 60000);
    const all = this.getAll();
    all.unshift({ ...notif, id: Date.now(), read: false, time: new Date().toISOString() });
    this.save(all);
    return true;
  },
  markRead(id) { const all = this.getAll(); const n = all.find(x => x.id === id); if (n) n.read = true; this.save(all); },
  markAllRead() { const all = this.getAll(); all.forEach(n => n.read = true); this.save(all); },
  clear() { this.save([]); },
  unreadCount() { return this.getAll().filter(n => !n.read).length; }
};

// Toast: zarif mini bildirim + panele kaydet
function toast(message, severity = 'success', options = {}) {
  // Sistemsel/Teknik hataları kullanıcı dostu hale getir
  if (message && message.includes && message.includes('timeout')) {
    message = 'Sunucu aşırı yoğunluk sebebiyle yanıt veremedi (Zaman aşımı). Lütfen tekrar deneyin.';
    severity = 'warning';
  } else if (message && message.includes && message.includes('Failed to fetch')) {
    message = 'İnternet bağlantınız koptu veya sunucuya ulaşılamıyor.';
    severity = 'error';
  }

  const { save = true, title, icon, phone } = options;
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast show ' + severity;
  const duration = severity === 'critical' ? 6000 : severity === 'warning' ? 4500 : 3000;
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.className = 'toast', duration);

  // Panele kaydet
  if (save) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️', critical: '🚨' };
    const added = _notifStore.add({
      title: title || (severity === 'success' ? 'İşlem Başarılı' : severity === 'error' ? 'Sistem Hatası' : severity === 'warning' ? 'Uyarı' : severity === 'critical' ? 'Kritik Hata' : 'Bilgi'),
      desc: message,
      severity: severity,
      icon: icon || icons[severity] || '📌',
      phone: phone || null
    });
    if (added) updateNotifBadge();
  }
}

// Bildirim paneli aç/kapat
function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  const overlay = document.getElementById('notif-overlay');
  const isOpen = panel.style.display !== 'none';
  if (isOpen) {
    panel.style.display = 'none';
    overlay.style.display = 'none';
  } else {
    renderNotifList();
    panel.style.display = 'flex';
    overlay.style.display = 'block';
  }
}

// Bildirim listesi render
function renderNotifList() {
  const list = _notifStore.getAll();
  const container = document.getElementById('notif-list');
  if (list.length === 0) {
    container.innerHTML = '<div class="notif-empty">🔕 Bildirim yok</div>';
    return;
  }
  container.innerHTML = list.map(n => {
    const timeAgo = getTimeAgo(n.time);
    return `<div class="notif-item ${n.read ? '' : 'unread'} severity-${n.severity || 'info'}" onclick="onNotifClick(${n.id})">
      <div class="notif-icon">${n.icon || '📌'}</div>
      <div class="notif-body">
        <div class="notif-title">${n.title}</div>
        <div class="notif-desc" title="${n.desc}">${n.desc}</div>
      </div>
      <div class="notif-time">${timeAgo}</div>
    </div>`;
  }).join('');
}

// Zaman farkı
function getTimeAgo(isoTime) {
  const diff = Date.now() - new Date(isoTime).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Az önce';
  if (mins < 60) return mins + 'dk';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'sa';
  return Math.floor(hours / 24) + 'g';
}

// Bildirime tıklama
function onNotifClick(id) {
  const all = _notifStore.getAll();
  const n = all.find(x => x.id === id);
  if (n) {
    if (n.phone) {
      toggleNotifPanel();
      // Telefon numarasından ilgili satırı bul ve detayını aç
      navigateToLeadByPhone(n.phone);
    }
    if (n.dbId) {
      // Veritabanında da okundu işaretle
      api('mark-alert-read', 'POST', { id: n.dbId }).catch(() => {});
    }
  }
  
  _notifStore.markRead(id);
  renderNotifList();
  updateNotifBadge();
}

// Telefon numarasına göre lead detayına git
function navigateToLeadByPhone(phone) {
  if (!phone) return;
  const cleanPhone = phone.replace(/\D/g, '');
  
  // Eğer sheet verileri yüklüyse, form yönetimi sayfasında aç
  if (window._sheetRows && window._sheetHeaders) {
    const phoneCol = window._sheetHeaders.findIndex(h => {
      const l = h.toLowerCase().replace(/[_\s]+/g, '');
      return l === 'phonenumber' || l === 'phone' || l === 'telefon' || l === 'tel' || l === 'gsm' || l === 'cep';
    });
    
    if (phoneCol > -1) {
      const rowIndex = window._sheetRows.findIndex(row => {
        const rp = (row[phoneCol] || '').replace(/\D/g, '');
        return rp === cleanPhone || rp.endsWith(cleanPhone.slice(-10)) || cleanPhone.endsWith(rp.slice(-10));
      });
      
      if (rowIndex > -1) {
        document.querySelector('[data-page="form-management"]')?.click();
        setTimeout(() => openLeadDetail(rowIndex), 300);
        return;
      }
    }
  }
  
  // Fallback: Sohbet ekranında aç
  document.querySelector('[data-page="conversations"]')?.click();
  setTimeout(() => loadChat(cleanPhone, 'whatsapp'), 300);
}

// Tümünü okundu işaretle
function markAllNotifRead() {
  const all = _notifStore.getAll();
  all.forEach(n => {
    n.read = true;
    if (n.dbId) api('mark-alert-read', 'POST', { id: n.dbId }).catch(() => {});
  });
  _notifStore.save(all);
  renderNotifList();
  updateNotifBadge();
}

// Temizle
function clearAllNotifs() {
  const all = _notifStore.getAll();
  all.forEach(n => {
    if (n.dbId) api('mark-alert-read', 'POST', { id: n.dbId }).catch(() => {});
  });
  _notifStore.clear();
  renderNotifList();
  updateNotifBadge();
}

// Badge sayacı güncelle
function updateNotifBadge() {
  const count = _notifStore.unreadCount();
  const badge = document.getElementById('notif-count');
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'block' : 'none';
  }
}

// Sayfa yüklendiğinde badge güncelle
document.addEventListener('DOMContentLoaded', () => updateNotifBadge());


async function api(a, m='GET', b=null) {
  const o = {method:m, headers:{'Content-Type':'application/json', Authorization:'Bearer '+AUTH_TOKEN}};
  if(b) o.body = JSON.stringify(b);
  const r = await fetch(API+'?action='+a, o);
  if(r.status===401) { checkAuth(); return null; }
  return r.json();
}

/* ═══════════════════════════════════════════════════════════ */
/* KOMUTA MERKEZİ — Birleşik Dashboard + Analitik             */
/* ═══════════════════════════════════════════════════════════ */
let _ccChart = null;
let _ccData = null;
let _ccCurrentChart = 'leads';

function setCCPeriod(days) {
  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  document.getElementById('cc-from').value = from.toISOString().slice(0, 10);
  document.getElementById('cc-to').value = to.toISOString().slice(0, 10);
  document.querySelectorAll('#cc-period-pills .sheet-tab').forEach(b => b.classList.remove('active'));
  document.querySelector(`#cc-period-pills [data-days="${days}"]`)?.classList.add('active');
  loadCommandCenter();
}

function switchCCChart(type) {
  _ccCurrentChart = type;
  document.querySelectorAll('#cc-chart-tabs .sheet-tab').forEach(b => b.classList.remove('active'));
  document.querySelector(`#cc-chart-tabs [data-chart="${type}"]`)?.classList.add('active');
  if (_ccData) renderCCChart(_ccData);
}

async function loadCommandCenter() {
  // Tarih aralığını input'lardan oku
  let from = document.getElementById('cc-from')?.value;
  let to = document.getElementById('cc-to')?.value;
  if (!from) {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    from = d.toISOString().slice(0, 10);
    document.getElementById('cc-from').value = from;
  }
  if (!to) {
    to = new Date().toISOString().slice(0, 10);
    document.getElementById('cc-to').value = to;
  }

  const d = await api(`analytics-summary&from=${from}&to=${to}`);
  if (!d || d.error) return;
  _ccData = d;

  // ── KPI Hero Bar ──
  const k = d.kpi;
  const kpiEl = document.getElementById('cc-kpi-bar');
  const kpiCards = [
    { val: k.totalLeads, label: 'Toplam Lead', color: '#BF5AF2', icon: '📋' },
    { val: `${k.conversionRate}%`, label: 'Dönüşüm', color: k.conversionRate >= 20 ? '#30D158' : k.conversionRate >= 10 ? '#FF9F0A' : '#FF453A', icon: '🎯' },
    { val: k.appointedCount, label: 'Randevu', color: '#30D158', icon: '✅' },
    { val: `${k.avgResponseMin || '<1'}dk`, label: 'Ort. Yanıt', color: k.avgResponseMin <= 5 ? '#30D158' : '#FF9F0A', icon: '⏱' },
    { val: `$${k.totalAICost}`, label: 'AI Maliyet', color: '#0A84FF', icon: '🤖' },
    { val: k.lostCount, label: 'Kayıp', color: '#FF453A', icon: '❌' }
  ];
  kpiEl.innerHTML = kpiCards.map(c => `
    <div class="stat-card" style="text-align:center; padding:18px 12px;">
      <div style="font-size:28px; font-weight:800; color:${c.color}; letter-spacing:-1px;">${c.val}</div>
      <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">${c.icon} ${c.label}</div>
    </div>
  `).join('');

  // ── Grafik ──
  renderCCChart(d);

  // ── Funnel ──
  const funnelEl = document.getElementById('cc-funnel');
  const maxFunnel = Math.max(...d.funnel.map(f => f.count), 1);
  const funnelColors = { new: '#F59E0B', contacted: '#3B82F6', discovery: '#8B5CF6', negotiation: '#F97316', hot_lead: '#EF4444', appointed: '#22C55E', lost: '#6B7280' };
  funnelEl.innerHTML = d.funnel.map(f => {
    const pct = Math.round((f.count / maxFunnel) * 100);
    const c = funnelColors[f.stage] || '#6B7280';
    return `<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
      <span style="font-size:11px; width:90px; color:var(--text-muted); text-align:right;">${f.label}</span>
      <div style="flex:1; background:var(--bg-hover); border-radius:4px; height:20px; overflow:hidden; position:relative;">
        <div style="width:${pct}%; height:100%; background:${c}; border-radius:4px; transition:width 0.5s;"></div>
        <span style="position:absolute; right:6px; top:2px; font-size:10px; font-weight:700; color:white;">${f.count}</span>
      </div>
    </div>`;
  }).join('');

  // ── Ülkeler ──
  const countriesEl = document.getElementById('cc-countries');
  countriesEl.innerHTML = d.countries.length > 0 ? d.countries.map(c => {
    const cvr = c.count > 0 ? Math.round((c.converted / c.count) * 100) : 0;
    return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--bg-hover); border-radius:8px; margin-bottom:4px;">
      <span style="font-size:13px; font-weight:500;">🌍 ${c.city}</span>
      <div style="display:flex; gap:12px; align-items:center;">
        <span style="font-size:12px; color:var(--text-muted);">${c.count} lead</span>
        <span style="font-size:12px; font-weight:700; color:${cvr >= 20 ? '#30D158' : cvr >= 10 ? '#FF9F0A' : '#FF453A'};">${cvr}%</span>
      </div>
    </div>`;
  }).join('') : '<div class="empty" style="padding:20px;">📍 Henüz şehir/ülke verisi yok</div>';

  // ── Bölümler ──
  const deptEl = document.getElementById('cc-departments');
  deptEl.innerHTML = d.departments.length > 0 ? d.departments.map(dep => {
    const cvr = dep.count > 0 ? Math.round((dep.converted / dep.count) * 100) : 0;
    return `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--bg-hover); border-radius:8px; margin-bottom:4px;">
      <span style="font-size:13px; font-weight:500;">🏥 ${dep.name}</span>
      <div style="display:flex; gap:12px; align-items:center;">
        <span style="font-size:12px; color:var(--text-muted);">${dep.count} hasta</span>
        <span style="font-size:12px; font-weight:700; color:${cvr >= 20 ? '#30D158' : cvr >= 10 ? '#FF9F0A' : '#FF453A'};">${cvr}% dönüşüm</span>
      </div>
    </div>`;
  }).join('') : '<div class="empty" style="padding:20px;">🏥 Henüz bölüm verisi yok</div>';

  // ── Kampanyalar ──
  const campEl = document.getElementById('cc-campaigns');
  campEl.innerHTML = d.campaigns.length > 0 ? `
    <div style="display:grid; grid-template-columns:2fr 1fr 1fr 1fr; gap:4px; font-size:11px; color:var(--text-muted); padding:4px 12px; font-weight:600;">
      <span>Kampanya</span><span style="text-align:center">Lead</span><span style="text-align:center">Dönüşüm</span><span style="text-align:center">Kayıp</span>
    </div>
    ${d.campaigns.map(c => {
      const cvr = c.leads > 0 ? Math.round((c.converted / c.leads) * 100) : 0;
      return `<div style="display:grid; grid-template-columns:2fr 1fr 1fr 1fr; gap:4px; padding:8px 12px; background:var(--bg-hover); border-radius:8px; margin-bottom:4px; font-size:12px; align-items:center;">
        <span style="font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${c.name}">📣 ${c.name.substring(0, 35)}${c.name.length > 35 ? '…' : ''}</span>
        <span style="text-align:center; font-weight:600;">${c.leads}</span>
        <span style="text-align:center; font-weight:700; color:${cvr >= 20 ? '#30D158' : '#FF9F0A'};">${c.converted} (${cvr}%)</span>
        <span style="text-align:center; color:#FF453A;">${c.lost}</span>
      </div>`;
    }).join('')}
  ` : '<div class="empty" style="padding:20px;">📣 Henüz kampanya verisi yok</div>';

  // ── AI Model & Maliyet ──
  const modelsEl = document.getElementById('cc-models');
  const totalCost = d.models.reduce((s, m) => s + m.estimatedCost, 0);
  modelsEl.innerHTML = d.models.length > 0 ? `
    ${d.models.map(m => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--bg-hover); border-radius:8px; margin-bottom:4px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:14px;">🤖</span>
          <span style="font-size:13px; font-weight:500;">${m.model}</span>
        </div>
        <div style="display:flex; gap:16px; align-items:center;">
          <span style="font-size:12px; color:var(--text-muted);">${m.count} çağrı</span>
          <span style="font-size:12px; font-weight:700; color:#0A84FF;">$${m.estimatedCost.toFixed(3)}</span>
        </div>
      </div>
    `).join('')}
    <div style="display:flex; justify-content:space-between; padding:10px 12px; margin-top:8px; background:rgba(10,132,255,0.1); border-radius:8px; border:1px solid rgba(10,132,255,0.2);">
      <span style="font-size:13px; font-weight:600;">💰 Toplam AI Maliyeti</span>
      <span style="font-size:15px; font-weight:800; color:#0A84FF;">$${totalCost.toFixed(2)}</span>
    </div>
    <div style="font-size:11px; color:var(--text-muted); margin-top:6px; text-align:center;">
      📊 Koordinatör maliyetine göre <strong style="color:#30D158;">${k.humanSavings}x</strong> tasarruf
    </div>
  ` : '<div class="empty" style="padding:20px;">🤖 Model kullanım verisi yok</div>';

  // ── Kayıp Lead Analizi ──
  const lostEl = document.getElementById('cc-lost-leads');
  lostEl.innerHTML = d.lostLeads.length > 0 ? `
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr 2fr auto; gap:4px; font-size:11px; color:var(--text-muted); padding:4px 12px; font-weight:600;">
      <span>Hasta</span><span>Bölüm</span><span>Tarih</span><span>Son Mesaj</span><span></span>
    </div>
    ${d.lostLeads.map(l => `
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr 2fr auto; gap:4px; padding:8px 12px; background:var(--bg-hover); border-radius:8px; margin-bottom:4px; font-size:12px; align-items:center;">
        <span style="font-weight:500;">${l.name || '—'}</span>
        <span style="color:var(--text-muted);">${l.dept || '—'}</span>
        <span style="color:var(--text-muted);">${l.date ? new Date(l.date).toLocaleDateString('tr-TR') : '—'}</span>
        <span style="color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${(l.lastMessage || '').substring(0, 100)}">${(l.lastMessage || '—').substring(0, 50)}${(l.lastMessage || '').length > 50 ? '…' : ''}</span>
        <button onclick="document.querySelector('[data-page=\\'conversations\\']')?.click(); setTimeout(function(){ loadChat('${l.phone}', 'whatsapp'); }, 300);" style="background:rgba(10,132,255,0.15); color:#0A84FF; border:1px solid rgba(10,132,255,0.3); padding:4px 10px; border-radius:6px; font-size:11px; cursor:pointer; white-space:nowrap;">🔄 Recovery</button>
      </div>
    `).join('')}
    <div style="font-size:11px; color:var(--text-muted); margin-top:8px; text-align:center;">
      💡 Recovery butonuna tıklayarak kayıp lead'lerle yeniden iletişime geçebilirsiniz
    </div>
  ` : '<div class="empty" style="padding:20px;">✅ Kayıp lead yok — harika!</div>';
}

function renderCCChart(d) {
  const ctx = document.getElementById('cc-main-chart');
  if (!ctx) return;
  if (_ccChart) { _ccChart.destroy(); _ccChart = null; }
  
  const chartCfg = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888', font: { size: 10 } } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888', font: { size: 10 } }, beginAtZero: true } } };

  if (_ccCurrentChart === 'leads') {
    _ccChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: d.dailyLeads.map(x => new Date(x.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })),
        datasets: [{ label: 'Yeni Lead', data: d.dailyLeads.map(x => x.count), backgroundColor: 'rgba(191,90,242,0.6)', borderRadius: 6, borderSkipped: false }]
      },
      options: chartCfg
    });
  } else if (_ccCurrentChart === 'messages') {
    _ccChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: d.dailyMessages.map(x => new Date(x.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })),
        datasets: [
          { label: 'Gelen', data: d.dailyMessages.map(x => x.incoming), borderColor: '#30D158', backgroundColor: 'rgba(48,209,88,0.1)', fill: true, tension: 0.4, pointRadius: 2 },
          { label: 'Giden', data: d.dailyMessages.map(x => x.outgoing), borderColor: '#0A84FF', backgroundColor: 'rgba(10,132,255,0.1)', fill: true, tension: 0.4, pointRadius: 2 }
        ]
      },
      options: { ...chartCfg, plugins: { legend: { display: true, labels: { color: '#888', font: { size: 11 } } } } }
    });
  } else if (_ccCurrentChart === 'hourly') {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const hourData = hours.map(h => { const found = d.hourly.find(x => x.hour === h); return found ? found.count : 0; });
    _ccChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: hours.map(h => `${h}:00`),
        datasets: [{ label: 'Mesaj', data: hourData, backgroundColor: 'rgba(16,185,129,0.5)', borderRadius: 4, borderSkipped: false }]
      },
      options: chartCfg
    });
  }
}

/* DASHBOARD (eski — artık kullanılmıyor ama geriye uyumluluk) */
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
    
    // 🎯 KPI Kartları
    const kpiEl = document.getElementById('kpi-cards');
    if (kpiEl) {
      const ls = d.leadStats;
      const crColor = ls.conversionRate >= 25 ? 'var(--system-green)' : (ls.conversionRate >= 10 ? 'var(--system-orange)' : 'var(--system-red)');
      const rtColor = ls.avgResponseMin <= 5 ? 'var(--system-green)' : (ls.avgResponseMin <= 30 ? 'var(--system-orange)' : 'var(--system-red)');
      const rrColor = ls.responseRate >= 60 ? 'var(--system-green)' : (ls.responseRate >= 30 ? 'var(--system-orange)' : 'var(--system-red)');
      
      kpiEl.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px,1fr)); gap:10px;">
          <div style="background:var(--bg-card); border-radius:12px; padding:14px; text-align:center; cursor:pointer;" onclick="document.querySelector('[data-page=conversations]').click()">
            <div style="font-size:24px; font-weight:800; color:${crColor};">${ls.conversionRate}%</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">🎯 Dönüşüm</div>
          </div>
          <div style="background:var(--bg-card); border-radius:12px; padding:14px; text-align:center;">
            <div style="font-size:24px; font-weight:800; color:${rtColor};">${ls.avgResponseMin}<span style="font-size:12px">dk</span></div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">⏱ İlk Yanıt</div>
          </div>
          <div style="background:var(--bg-card); border-radius:12px; padding:14px; text-align:center; cursor:pointer;" onclick="document.querySelector('[data-page=conversations]').click();setTimeout(()=>{currentPipelineFilter='hot_lead';renderConversationList(window._lastConvData||[])},300)">
            <div style="font-size:24px; font-weight:800; color:${ls.hotLeads > 0 ? 'var(--system-red)' : 'var(--system-green)'};">${ls.hotLeads}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">🔥 Sıcak Lead</div>
          </div>
          <div style="background:var(--bg-card); border-radius:12px; padding:14px; text-align:center;">
            <div style="font-size:24px; font-weight:800; color:${rrColor};">${ls.responseRate}%</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">📊 Yanıt Oranı</div>
          </div>
          <div style="background:var(--bg-card); border-radius:12px; padding:14px; text-align:center; cursor:pointer;" onclick="document.querySelector('[data-page=appointments]').click()">
            <div style="font-size:24px; font-weight:800; color:${ls.showUpRate >= 70 ? 'var(--system-green)' : (ls.showUpRate >= 40 ? 'var(--system-orange)' : 'var(--system-red)')}">${ls.showUpRate}%</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">🏥 Show-up</div>
          </div>
          <div style="background:var(--bg-card); border-radius:12px; padding:14px; text-align:center;">
            <div style="font-size:24px; font-weight:800; color:${parseFloat(ls.avgSatisfaction) >= 4 ? 'var(--system-green)' : (parseFloat(ls.avgSatisfaction) >= 3 ? 'var(--system-orange)' : 'var(--system-red)')}">${ls.avgSatisfaction}<span style="font-size:12px">/5</span></div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">⭐ Memnuniyet</div>
          </div>
        </div>
        ${Object.keys(ls.funnelPhases || {}).length > 0 ? `
        <div style="margin-top:14px;">
          <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:8px;">📊 Funnel Dağılımı</div>
          ${(() => {
            const fp = ls.funnelPhases;
            const total = Object.values(fp).reduce((a,b) => a+b, 0) || 1;
            const labels = {greeting:'Karşılama',discovery:'Keşif',trust:'Güven',handover:'Devir',pending_welcome:'Bekleyen'};
            const colors = {greeting:'#3b82f6',discovery:'#8b5cf6',trust:'#f59e0b',handover:'#22c55e',pending_welcome:'#6b7280'};
            return Object.entries(fp).map(([k,v]) => {
              const pct = Math.round(v/total*100);
              return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span style="font-size:11px;width:70px;color:var(--text-muted);">' + (labels[k]||k) + '</span><div style="flex:1;background:var(--bg-hover);border-radius:4px;height:14px;overflow:hidden;"><div style="width:'+pct+'%;height:100%;background:'+(colors[k]||'#3b82f6')+';border-radius:4px;transition:width 0.3s;"></div></div><span style="font-size:11px;font-weight:600;width:40px;text-align:right;">'+v+'</span></div>';
            }).join('');
          })()}
        </div>` : ''}
      `;
    }
  }
  
  document.getElementById('recent-messages').innerHTML = (d.recentMessages||[]).map(m => {
    const icon = m.direction === 'in' ? '👤' : '🤖';
    const isBot = m.direction === 'out' ? 'background: rgba(10, 132, 255, 0.1); border: 1px solid transparent;' : 'background: var(--bg-hover); border: 1px solid transparent;';
    return `<div style="${isBot} padding: 12px 16px; border-radius: 14px; display:flex; gap:12px; align-items:center; margin-bottom: 8px;">
      <div style="font-size:20px; opacity:0.8;">${icon}</div>
      <div style="flex:1; overflow:hidden;">
        <div style="font-size:13px; font-weight:600; color:var(--text-main); margin-bottom:4px; letter-spacing: -0.2px;">${escapeHtml(m.patient_name || m.phone_number)}</div>
        <div style="font-size:13px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(m.content)}</div>
      </div>
      <div style="font-size:11px; color:var(--text-muted); align-self:flex-start;">${new Date(m.created_at).toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'})}</div>
    </div>`;
  }).join('') || '<div class="empty">Etkileşim yok</div>';
}

// ========== FORM YÖNETİMİ — Load Once, Filter Locally ==========
window._allSheetData = null;
window._activeSheet = null;
window._enrichCache = {};
window._formFilter = 'all';
window._sheetRefreshTimer = null;
window._lastSheetRowCount = 0;

function loadFormManagement() {
  loadAllSheets();
  if (window._sheetRefreshTimer) clearInterval(window._sheetRefreshTimer);
  window._sheetRefreshTimer = setInterval(() => {
    const currentPage = document.querySelector('.nav-btn.active')?.dataset?.page;
    if (currentPage === 'form-management') { silentRefreshSheets(); }
    else { clearInterval(window._sheetRefreshTimer); window._sheetRefreshTimer = null; }
  }, 45000);
}

async function loadAllSheets() {
  document.getElementById('lead-list').innerHTML = renderSkeleton(8);
  try {
    const resp = await fetch('/api/sheets?action=all');
    const data = await resp.json();
    if (!data.success || !data.allData) {
      // Fallback: eski yöntem ile yükle
      console.warn('batchGet failed, falling back to legacy mode');
      return loadAllSheetsFallback();
    }
    window._allSheetData = data.allData;
    const tabs = data.tabs || [];
    if (!window._activeSheet && tabs.length > 0) window._activeSheet = tabs[0].title;
    renderSheetTabs(tabs);
    switchToTab(window._activeSheet);
  } catch(e) {
    console.warn('loadAllSheets error:', e);
    return loadAllSheetsFallback();
  }
}

// Fallback: Eski yöntem — tabs + ilk tab'ı ayrı ayrı çek
async function loadAllSheetsFallback() {
  try {
    const resp = await fetch('/api/sheets');
    const data = await resp.json();
    if (!data.success) { document.getElementById('lead-list').innerHTML = `<p class="empty">❌ ${data.error}</p>`; return; }
    window._allSheetData = {};
    window._allSheetData[data.activeSheet] = { headers: data.headers, rows: data.rows, total: data.total };
    window._activeSheet = data.activeSheet;
    const tabs = data.tabs || [];
    renderSheetTabs(tabs);
    switchToTab(window._activeSheet);
    // Arka planda diğer tab'ları da yükle
    for (const tab of tabs) {
      if (tab.title === data.activeSheet) continue;
      try {
        const r = await fetch(`/api/sheets?action=data&sheet=${encodeURIComponent(tab.title)}`);
        const d = await r.json();
        if (d.success) window._allSheetData[tab.title] = { headers: d.headers, rows: d.rows, total: d.total };
        renderSheetTabs(tabs);
      } catch(e2) {}
    }
  } catch(e) { document.getElementById('lead-list').innerHTML = '<p class="empty">❌ Sheets bağlantı hatası</p>'; }
}

function renderSheetTabs(tabs) {
  document.getElementById('sheet-tabs').innerHTML = tabs.map(t => {
    const count = window._allSheetData?.[t.title]?.total || 0;
    return `<button class="sheet-tab ${t.title === window._activeSheet ? 'active' : ''}" data-title="${t.title.replace(/"/g, '&quot;')}" onclick="switchToTab('${t.title.replace(/'/g, "\\'")}')" style="border-radius:8px;">${t.title} <span style="opacity:0.6; font-size:11px;">(${count})</span></button>`;
  }).join('');
}

function switchToTab(tabName) {
  window._activeSheet = tabName;
  document.querySelectorAll('#sheet-tabs .sheet-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.title === tabName);
  });
  const si = document.getElementById('form-search-input');
  if (si) si.value = '';
  window._formFilter = 'all';
  document.querySelectorAll('#form-filter-chips .sheet-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === 'all');
  });
  const tabData = window._allSheetData?.[tabName];
  if (tabData) { renderSheetTable(tabData.headers, tabData.rows, tabData.total); }
  else { document.getElementById('lead-list').innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div>Bu kampanyada veri yok</div></div>'; document.getElementById('sheet-row-count').textContent = '📋 0 kayıt'; }
}

async function silentRefreshSheets() {
  try {
    const resp = await fetch('/api/sheets?action=all');
    const data = await resp.json();
    if (!data.success) return;
    const oldTotal = window._allSheetData?.[window._activeSheet]?.total || 0;
    window._allSheetData = data.allData;
    const newTotal = data.allData?.[window._activeSheet]?.total || 0;
    if (newTotal !== oldTotal) {
      renderSheetTabs(data.tabs || []);
      const tabData = data.allData[window._activeSheet];
      if (tabData) renderSheetTable(tabData.headers, tabData.rows, tabData.total);
    }
  } catch(e) {}
}

function renderSkeleton(count) {
  let s = '<div style="padding:16px; display:flex; flex-direction:column; gap:10px;">';
  for (let i = 0; i < count; i++) {
    s += `<div style="display:flex; align-items:center; gap:20px; padding:14px 16px; border-radius:8px; background:var(--bg-hover); animation:pulse 1.5s ease-in-out infinite;"><div style="width:140px; height:14px; background:rgba(255,255,255,0.06); border-radius:4px;"></div><div style="width:160px; height:16px; background:rgba(255,255,255,0.08); border-radius:4px;"></div><div style="flex:1; height:14px; background:rgba(255,255,255,0.05); border-radius:4px;"></div><div style="width:80px; height:24px; background:rgba(255,255,255,0.06); border-radius:12px;"></div></div>`;
  }
  return s + '</div>';
}

function filterFormLeads() {
  const tabData = window._allSheetData?.[window._activeSheet];
  if (tabData) renderSheetTable(tabData.headers, tabData.rows, tabData.total);
}

function setFormFilter(filter) {
  window._formFilter = filter;
  document.querySelectorAll('#form-filter-chips .sheet-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  filterFormLeads();
}

async function loadSheetData(sheetName) { switchToTab(sheetName); }
async function loadSheets() { loadAllSheets(); }

function renderSheetTable(headers, rows, total) {
  window._lastSheetRowCount = total;
  if (!headers || headers.length === 0) {
    document.getElementById('sheet-row-count').textContent = '📋 0 kayıt';
    return document.getElementById('lead-list').innerHTML = '<div class="empty"><div class="empty-icon">📭</div><div style="font-weight:500;">Kayıt yok</div></div>';
  }
  const findCol = (kw) => headers.findIndex(h => { const l = h.toLowerCase().replace(/[_\s]+/g, ''); return kw.some(k => l.includes(k)); });
  const findColStrict = (kw, mx = 30) => headers.findIndex(h => { if (h.length > mx) return false; const l = h.toLowerCase().replace(/[_\s]+/g, ''); return kw.some(k => l.includes(k)); });

  let dateCol = findCol(['time','tarih','created','date','zaman']);
  let nameCol = findCol(['fullname','full_name','isim','hastadi','hastaadi']);
  if (nameCol === -1) nameCol = headers.findIndex(h => /^ad$/i.test(h.trim()) || h.toLowerCase().includes('isim'));
  let whatsappCol = headers.findIndex(h => { const l = h.toLowerCase().replace(/[_\s]+/g, ''); return l.includes('whatsappnumarası') || l.includes('whatsappnumarasıyazınız'); });
  let telCol = headers.findIndex(h => h.toLowerCase().replace(/[_\s]+/g, '') === 'phonenumber');
  let phoneCol = whatsappCol > -1 ? whatsappCol : telCol;
  let campaignCol = findCol(['campaignname','campaign_name','kampanya']);
  let deptCol = findColStrict(['adname','ad_name','campaign','bolum','bölüm','form'], 40);
  // lead_status sütununu öncelikli ara, yoksa genel durum/aşama'ya fallback
  let statusCol = findColStrict(['leadstatus','lead_status']);
  if (statusCol === -1) statusCol = findColStrict(['durum','aşama']);
  let notesCol = findColStrict(['geridönüş','geridönus','geridönüs','notlar','notes','geridonus','açıklama','yorum']);
  if (dateCol === -1) dateCol = 0;
  if (nameCol === -1) nameCol = headers.length > 2 ? 2 : -1;
  window._sheetHeaders = headers; window._sheetRows = rows; window._whatsappCol = whatsappCol; window._telCol = telCol;

  const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtDate(r) { if (!r) return ''; const d = new Date(r); if (isNaN(d.getTime())) return r.split('T')[0]; return `${String(d.getDate()).padStart(2,'0')} ${mn[d.getMonth()]} ${d.getFullYear()} - ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }

  const sorted = [...rows].sort((a, b) => { const da = dateCol > -1 ? new Date(a[dateCol] || 0) : 0; const db = dateCol > -1 ? new Date(b[dateCol] || 0) : 0; return db - da; });
  window._sortedRowMap = sorted.map(r => rows.indexOf(r));

  const searchTerm = (document.getElementById('form-search-input')?.value || '').toLowerCase().trim();
  let filtered = sorted;
  if (searchTerm) {
    filtered = sorted.filter(row => {
      const n = (nameCol > -1 ? row[nameCol] : '') || '';
      const p = (phoneCol > -1 ? row[phoneCol] : '') || '';
      const dept = (deptCol > -1 ? row[deptCol] : '') || '';
      const c = (campaignCol > -1 ? row[campaignCol] : '') || '';
      return (n + ' ' + p + ' ' + dept + ' ' + c).toLowerCase().includes(searchTerm);
    });
  }

  const readLeads = JSON.parse(localStorage.getItem('readLeads') || '[]');
  let html = '<div class="lead-list-view" style="display:flex; flex-direction:column; gap:8px; padding:12px 16px 16px 16px;">';
  let rendered = 0;

  filtered.forEach((row) => {
    const origIdx = rows.indexOf(row);
    const dateVal = dateCol > -1 ? fmtDate(row[dateCol]) : '';
    const nameVal = nameCol > -1 ? (row[nameCol] || 'Bilinmiyor') : 'Bilinmiyor';
    const phoneVal = phoneCol > -1 ? (row[phoneCol] || '').replace(/\D/g, '') : '';
    const phoneDisplay = phoneVal.startsWith('90') && phoneVal.length >= 12 ? '+' + phoneVal.substring(0,2) + ' ' + phoneVal.substring(2,5) + ' ' + phoneVal.substring(5,8) + ' ' + phoneVal.substring(8,10) + ' ' + phoneVal.substring(10) : (phoneVal ? '+' + phoneVal : '');
    const campaignVal = campaignCol > -1 ? (row[campaignCol] || '') : '';
    const deptVal = deptCol > -1 ? (row[deptCol] || '') : '';
    const statusVal = statusCol > -1 ? (row[statusCol] || '') : '';
    const notesVal = notesCol > -1 ? (row[notesCol] || '') : '';

    let badgeHtml = '<span style="background:#f59e0b18; color:#f59e0b; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600;">🟡 Yeni</span>';
    let isUnread = true;
    let leadStatus = 'new';

    // Önce enrichCache'den DB stage'i kontrol et (varsa öncelikli)
    const cached = window._enrichCache?.[phoneVal];
    const dbStage = cached?.leadStage;
    
    if (dbStage && dbStage !== 'new') {
      // DB stage varsa, onu göster (pipeline stage'leri)
      const stageMap = { contacted:'📞 İlk Temas', discovery:'🩺 Analiz', negotiation:'🏛️ İkna', hot_lead:'🔥 Sıcak Lead', appointed:'✅ Randevu Alındı', lost:'❌ Kaybedildi' };
      const stageColors = { contacted:'#3b82f6', discovery:'#8b5cf6', negotiation:'#f97316', hot_lead:'#ef4444', appointed:'#22c55e', lost:'#6b7280' };
      const sc = stageColors[dbStage] || '#6b7280';
      badgeHtml = `<span style="background:${sc}18; color:${sc}; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600;">${stageMap[dbStage] || dbStage}</span>`;
      isUnread = false;
      leadStatus = dbStage === 'appointed' ? 'appointed' : dbStage === 'lost' ? 'lost' : 'active';
    } else if (statusVal.includes('SİSTEME ALINDI') || statusVal.includes('İletişime Geçildi')) { 
      badgeHtml = '<span style="background:#22c55e18; color:#22c55e; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600;">🟢 Dönüş Yapıldı</span>'; isUnread = false; leadStatus = 'active'; 
    }
    else if (statusVal.includes('Cevap Verdi') || statusVal.includes('İlgili')) { 
      badgeHtml = '<span style="background:#3b82f618; color:#3b82f6; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600;">💬 İletişimde</span>'; isUnread = false; leadStatus = 'active'; 
    }
    else if (statusVal && statusVal.toLowerCase() !== 'created') { 
      badgeHtml = `<span style="background:var(--bg-hover); color:white; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600;">${statusVal}</span>`; isUnread = false; leadStatus = 'active'; 
    }
    else if (notesVal.trim()) { 
      badgeHtml = '<span style="background:#22c55e18; color:#22c55e; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600;">✅ Cevap Verildi</span>'; isUnread = false; leadStatus = 'active'; 
    }
    if (readLeads.includes(phoneVal || `row-${origIdx}`)) isUnread = false;

    // cached varsa filtreleme için leadStatus güncelle
    if (cached) {
      if (cached.leadStage === 'appointed') leadStatus = 'appointed';
      else if (cached.leadStage === 'lost') leadStatus = 'lost';
      else if (cached.conversationStatus === 'human') leadStatus = 'human';
      else if (cached.conversationStatus === 'active' || (cached.leadStage && cached.leadStage !== 'new')) leadStatus = 'active';
    }

    if (window._formFilter !== 'all') {
      if (window._formFilter === 'new' && leadStatus !== 'new') return;
      if (window._formFilter === 'active' && leadStatus !== 'active') return;
      if (window._formFilter === 'human' && leadStatus !== 'human') return;
      if (window._formFilter === 'appointed' && leadStatus !== 'appointed') return;
      if (window._formFilter === 'lost' && leadStatus !== 'lost') return;
    }
    rendered++;

    const unreadStyle = isUnread ? 'border-left:4px solid #4ade80; background:rgba(74,222,128,0.05);' : 'border-left:4px solid transparent;';
    const campaignBadge = campaignVal ? `<span style="background:rgba(191,90,242,0.15); color:#bf5af2; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:500;">📣 ${campaignVal.substring(0,40)}${campaignVal.length > 40 ? '…' : ''}</span>` : '';

    html += `<div class="lead-card list-row" id="lead-row-${origIdx}" onclick="openLeadDetail(${origIdx})" style="display:flex; align-items:center; justify-content:space-between; border-radius:8px; padding:12px 16px; cursor:pointer; border:1px solid var(--border-color); transition:all 0.2s; ${unreadStyle}">
      <div style="display:flex; align-items:center; gap:24px; flex:1;">
        <div style="min-width:100px; max-width:170px; font-size:12px; color:var(--text-muted);">🗓 ${dateVal}</div>
        <div style="min-width:120px; max-width:200px; flex-shrink:0;"><div style="font-weight:600; color:white; margin-bottom:4px;">👤 ${nameVal}</div><div style="font-size:12px; color:#25D366;">🟢 ${phoneDisplay} ${countryBadge(phoneVal)}</div></div>
        <div style="flex:1; font-size:13px; color:var(--text-muted); display:flex; align-items:center; gap:8px; flex-wrap:wrap;">${campaignBadge}${deptVal ? `<span style="background:var(--bg-hover); padding:4px 8px; border-radius:4px;">🩺 ${deptVal.substring(0,50)}${deptVal.length > 50 ? '...' : ''}</span>` : ''}</div>
        <div id="lead-enrich-${origIdx}" style="display:flex; align-items:center; gap:6px; font-size:12px;"></div>
      </div>
      <div id="lead-badge-${origIdx}">${badgeHtml}</div>
    </div>`;
  });

  if (rendered === 0 && (searchTerm || window._formFilter !== 'all')) html += '<div class="empty" style="padding:40px;"><div class="empty-icon">🔍</div><div>Filtreye uygun lead bulunamadı</div></div>';
  html += '</div>';
  document.getElementById('lead-list').innerHTML = html;
  document.getElementById('sheet-row-count').textContent = `📋 ${rendered}${rendered !== total ? ' / ' + total : ''} kayıt`;
  enrichLeadCards(filtered, phoneCol);
}

async function enrichLeadCards(rows, phoneCol) {
  const token = localStorage.getItem('panel_token') || '';
  const batchSize = 8;
  for (let si = 0; si < rows.length; si += batchSize) {
    const batch = rows.slice(si, si + batchSize);
    await Promise.all(batch.map(async (row) => {
      const rawPhone = phoneCol > -1 ? (row[phoneCol] || '') : '';
      if (!rawPhone) return;
      const phone = rawPhone.replace(/\D/g, '');
      if (!phone || phone.length < 10) return;
      const origIdx = window._sheetRows?.indexOf(row) ?? -1;
      if (origIdx === -1) return;

      let ctx = window._enrichCache[phone];
      if (!ctx) {
        try {
          const resp = await fetch(`/api/panel?action=lead-context&phone=${encodeURIComponent(phone)}`, { headers: { Authorization: `Bearer ${token}` } });
          if (!resp.ok) return;
          ctx = await resp.json();
          if (ctx.error) return;
          window._enrichCache[phone] = ctx;
        } catch(e) { return; }
      }

      const el = document.getElementById(`lead-enrich-${origIdx}`);
      if (el) {
        let h = '';
        const icons = { whatsapp: '📱', instagram: '📸', messenger: '💬', web: '🌐' };
        (ctx.channels || []).forEach(ch => { h += `<span title="${ch}" style="font-size:14px;">${icons[ch] || '📞'}</span>`; });
        if (ctx.score > 0) { const sc = ctx.score >= 50 ? '#f97316' : ctx.score >= 30 ? '#facc15' : '#6b7280'; h += `<span style="background:${sc}22; color:${sc}; border:1px solid ${sc}44; border-radius:4px; padding:2px 6px; font-weight:600; font-size:11px;">⚡ ${ctx.score}</span>`; }
        if (ctx.lastMessage) { h += `<span style="color:#60a5fa; font-size:11px; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(ctx.lastMessage.content)}">&ldquo;${escapeHtml(ctx.lastMessage.content.substring(0,25))}...&rdquo;</span>`; }
        el.innerHTML = h;
      }

      const badgeEl = document.getElementById(`lead-badge-${origIdx}`);
      if (!badgeEl) return;
      const stages = { new:'🆕 Yeni', contacted:'📞 İlk Temas', discovery:'🩺 Analiz', negotiation:'🏛️ İkna', hot_lead:'🔥 Sıcak', appointed:'✅ Randevu', lost:'❌ Kayıp' };
      const stageColors = { new:'#f59e0b', contacted:'#3b82f6', discovery:'#8b5cf6', negotiation:'#f97316', hot_lead:'#ef4444', appointed:'#22c55e', lost:'#6b7280' };
      const leadStage = ctx.leadStage || (ctx.conversationStatus ? 'contacted' : null);
      let sb = '';
      if (ctx.conversationStatus === 'active') sb += `<span style="background:rgba(48,209,88,0.12); color:#30D158; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">🤖 Bot</span>`;
      else if (ctx.conversationStatus === 'human') sb += `<span style="background:rgba(255,159,10,0.12); color:#FF9F0A; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">👤 Manuel</span>`;
      if (leadStage && leadStage !== 'new') { const sc = stageColors[leadStage] || '#6b7280'; sb += `<span style="background:${sc}18; color:${sc}; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">${stages[leadStage] || leadStage}</span>`; }
      const tagColors = { 'Olumsuz':'#ef4444','Randevu Alındı':'#22c55e','Takvimde':'#3b82f6','Randevu İstiyor':'#f59e0b','Düşünüyor':'#a855f7','Tedavi Oldu':'#10b981', 'Sıcak Lead':'#ef4444' };
      if (ctx.tags?.length > 0) ctx.tags.forEach(tag => { const tc = tagColors[tag] || '#6b7280'; sb += `<span style="background:${tc}15; color:${tc}; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">${tag}</span>`; });
      const readLeads = JSON.parse(localStorage.getItem('readLeads') || '[]');
      const isNew = !readLeads.includes(phone) && (!leadStage || leadStage === 'new');
      if (isNew) sb += `<span style="background:#f59e0b18; color:#f59e0b; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">🟡 Yeni</span>`;
      
      if (ctx.score >= 50 && (!ctx.tags || !ctx.tags.includes('Sıcak Lead'))) {
        sb += `<span style="background:rgba(239,68,68,0.15); color:#ef4444; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:700;">🔥 Sıcak Lead</span>`;
      }

      if (sb) badgeEl.innerHTML = `<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">${sb}</div>`;
      const rowEl = document.getElementById(`lead-row-${origIdx}`);
      if (rowEl && !isNew) { rowEl.style.borderLeftColor = 'transparent'; rowEl.style.background = 'var(--card-bg)'; }
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
let currentPipelineFilter = 'all';
let cachedConversations = [];

// Merkezi effectiveStage hesaplama (tüm UI'larda tutarlı)
function getEffectiveStage(c) {
  let effectiveStage = c.lead_stage || 'new';
  if (effectiveStage === 'new' || effectiveStage === 'responded') {
    const phaseStage = BOT_PHASE_TO_STAGE[c.phase];
    if (phaseStage) effectiveStage = phaseStage;
  }
  if (c.temperature === 'hot' && effectiveStage !== 'appointed') effectiveStage = 'hot_lead';
  if (c.status === 'human' && !['appointed', 'lost', 'hot_lead'].includes(effectiveStage)) effectiveStage = 'hot_lead';
  if (effectiveStage === 'responded') effectiveStage = 'discovery';
  if (effectiveStage === 'appointment_request') effectiveStage = 'hot_lead';
  return effectiveStage;
}

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

function setPipelineFilter(stage) {
  currentPipelineFilter = stage;
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
  
  // Her konuşmanın effectiveStage'ini hesapla
  list.forEach(c => { c._effectiveStage = getEffectiveStage(c); });
  
  // 🎯 Pipeline hapları render et
  const stageCounts = { all: list.length };
  Object.keys(PIPELINE_STAGES).forEach(s => { stageCounts[s] = 0; });
  list.forEach(c => { stageCounts[c._effectiveStage] = (stageCounts[c._effectiveStage] || 0) + 1; });
  
  const pillsEl = document.getElementById('pipeline-pills');
  if (pillsEl) {
    pillsEl.innerHTML = `
      <button class="pipeline-pill ${currentPipelineFilter === 'all' ? 'active' : ''}" onclick="setPipelineFilter('all')" style="${currentPipelineFilter === 'all' ? 'border-color:var(--accent-primary); color:white; background:rgba(10,132,255,0.12);' : ''}">
        <span class="pill-count">${stageCounts.all}</span> Tümü
      </button>
      ${Object.entries(PIPELINE_STAGES).map(([stage, cfg]) => {
        const count = stageCounts[stage] || 0;
        const isActive = currentPipelineFilter === stage;
        const activeStyle = isActive ? `border-color:${cfg.color}; color:${cfg.color}; background:${cfg.color}15;` : '';
        return `<button class="pipeline-pill ${isActive ? 'active' : ''}" onclick="setPipelineFilter('${stage}')" style="${activeStyle}">
          <span class="pill-dot" style="background:${cfg.color};"></span>
          <span class="pill-count" style="${isActive ? `background:${cfg.color}33;` : ''}">${count}</span>
          ${cfg.label}
        </button>`;
      }).join('')}
    `;
  }
  
  // Kanal sayaçları
  const counts = {all: list.length, whatsapp: 0, messenger: 0, instagram: 0};
  list.forEach(c => { const ch = c.last_channel || c.channel || 'whatsapp'; counts[ch] = (counts[ch]||0) + 1; });
  document.getElementById('count-all').textContent = counts.all;
  document.getElementById('count-whatsapp').textContent = counts.whatsapp;
  document.getElementById('count-messenger').textContent = counts.messenger;
  document.getElementById('count-instagram').textContent = counts.instagram;

  // Filtre uygula: Pipeline + Kanal + Arama
  let filtered = list;
  if (currentPipelineFilter !== 'all') {
    filtered = filtered.filter(c => c._effectiveStage === currentPipelineFilter);
  }
  if (currentInboxFilter !== 'all') {
    filtered = filtered.filter(c => (c.last_channel || c.channel || 'whatsapp') === currentInboxFilter);
  }
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
    
    // 🎯 Pipeline Badge (merkezi hesaplama kullan)
    const stageBadge = getStageBadge(c._effectiveStage || 'new');

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

    // Score badge (varsa)
    const score = c.lead_score || 0;
    const scoreBadge = score > 0 
      ? `<span style="font-size:10px; background:${score >= 80 ? 'rgba(48,209,88,0.15)' : score >= 60 ? 'rgba(48,209,88,0.1)' : score >= 30 ? 'rgba(255,214,10,0.12)' : 'rgba(255,69,58,0.1)'}; color:${score >= 60 ? '#30d158' : score >= 30 ? '#ffd60a' : '#ff453a'}; padding:1px 6px; border-radius:6px; font-weight:600;">${score}p</span>` 
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
        <div class="contact-badges">${stageBadge}${stBadge}${scoreBadge ? ' ' + scoreBadge : ''}${formBadge ? ' ' + formBadge : ''}</div>
      </div>
    </div>`;
  }).join('') || '<div class="empty" style="padding:30px">Konuşma bulunamadı</div>';
}

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
  chatEl.innerHTML = msgs.map(m => {
    const isOut = m.direction === 'out';
    const isBot = m.model_used && m.model_used !== 'panel' && m.model_used !== 'toplu';
    const cls = `message-bubble ${isOut ? 'out' : 'in'} ${isOut && isBot ? 'bot-reply' : ''}`;
    const senderLabel = isOut ? (isBot ? '🤖 Bot' : '👤 Sen') : '📩 Hasta';
    const info = `<div class="msg-info">${senderLabel} · ${new Date(m.created_at).toLocaleTimeString('tr-TR', {hour:'2-digit',minute:'2-digit'})} ${isBot ? '<span class="bot-indicator">' + m.model_used + '</span>' : ''}</div>`;
    
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
    return `<div class="${cls}">${content}${info}</div>`;
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


// ═══ EVRENSEL: Stage → Sheets senkronizasyonu (SADECE lokal cache güncelle, gerçek sync backend'de) ═══
async function syncStageToSheets(phone, newStage) {
  // Backend update-patient API zaten Google Sheets'e yazıyor.
  // Burada sadece frontend _sheetRows cache'ini güncelliyoruz (form yönetimi badge'leri için)
  if (!newStage || !window._sheetRows || !window._sheetHeaders) return;
  try {
    const stageLabels = { new: 'Yeni', contacted: 'İlk Temas', discovery: 'Analiz', negotiation: 'İkna', hot_lead: 'Sıcak Lead', appointed: 'Randevu Alındı', lost: 'Kayıp' };
    const cleanP = (phone || '').replace(/\D/g, '');
    const last10 = cleanP.length > 10 ? cleanP.slice(-10) : cleanP;
    
    const phoneColIdx = window._sheetHeaders.findIndex(h => /phone|telefon|tel|whatsapp|cep/i.test(h.toLowerCase()));
    // lead_status sütununu öncelikli ara
    let statusColIdx = window._sheetHeaders.findIndex(h => /^lead[_\s]?status$/i.test((h||'').trim()));
    if (statusColIdx === -1) statusColIdx = window._sheetHeaders.findIndex(h => /^(durum|aşama|lead[_\s]?stage)$/i.test((h||'').trim()));
    if (statusColIdx === -1) statusColIdx = window._sheetHeaders.findIndex(h => /lead_status|lead_stage/i.test((h||'').toLowerCase()));
    if (phoneColIdx === -1 || statusColIdx === -1) return;
    
    const rowIdx = window._sheetRows.findIndex(row => {
      const cellPhone = (row[phoneColIdx] || '').replace(/\D/g, '');
      return cellPhone.length >= 10 && (cellPhone.endsWith(last10) || last10.endsWith(cellPhone.slice(-10)));
    });
    
    if (rowIdx > -1) {
      window._sheetRows[rowIdx][statusColIdx] = stageLabels[newStage] || newStage;
    }
  } catch(e) { /* sessiz */ }
}

// ═══ EVRENSEL: Tüm view'lardaki cache/UI senkronizasyonu ═══
function syncStageToAllViews(phone, newStage) {
  const cleanP = (phone || '').replace(/\D/g, '');
  const last10 = cleanP.length > 10 ? cleanP.slice(-10) : cleanP;
  
  // 1. Inbox cache güncelle
  if (typeof cachedConversations !== 'undefined') {
    const cIdx = cachedConversations.findIndex(c => {
      const cp = (c.phone_number || '').replace(/\D/g, '');
      return cp.endsWith(last10) || last10.endsWith(cp.slice(-10));
    });
    if (cIdx > -1) {
      cachedConversations[cIdx].lead_stage = newStage;
      cachedConversations[cIdx]._effectiveStage = newStage;
    }
  }
  
  // 2. Enrich cache temizle (form yönetimi listesi — geri dönüldüğünde taze data çekilir)
  if (window._enrichCache) {
    Object.keys(window._enrichCache).forEach(key => {
      const keyClean = key.replace(/\D/g, '');
      if (keyClean.endsWith(last10) || last10.endsWith(keyClean.slice(-10))) {
        delete window._enrichCache[key];
      }
    });
  }
  
  // 3. İnbox sağ paneldeki label güncelle
  const stageCfg = PIPELINE_STAGES[newStage] || { emoji: '❓', label: newStage || '—' };
  const stageLabel = document.getElementById('crm-lead-stage');
  if (stageLabel) stageLabel.textContent = stageCfg.emoji + ' ' + stageCfg.label;
  
  // 4. İnbox dropdown'ı da güncelle (varsa)
  const stageSelect = document.getElementById('crm-stage');
  if (stageSelect) stageSelect.value = newStage;
  
  // 5. Inbox conversation list güncelle
  if (typeof renderConversationList === 'function') renderConversationList();
  
  // 6. Form yönetimi satırlarını güncelle (sayfa aktifse)
  if (typeof refreshLeadRowUI === 'function') refreshLeadRowUI(phone);
  
  // 7. Lokal sheet cache'ini de güncelle
  syncStageToSheets(phone, newStage);
}


function navigateToChat(phone) {
  if (!phone) return toast('Telefon numarası yok', 'error');
  // Form detay sayfasından çık
  const fdPage = document.getElementById('page-form-detail');
  if (fdPage) fdPage.style.display = 'none';
  // Conversations sayfasına geç
  document.querySelectorAll('.nav-btn').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.page').forEach(x => { x.classList.remove('active'); x.style.display = ''; });
  const convBtn = document.querySelector('[data-page="conversations"]');
  if (convBtn) convBtn.classList.add('active');
  const convPage = document.getElementById('page-conversations');
  if (convPage) convPage.classList.add('active');
  loadConversations();
  setTimeout(function(){ loadChat(phone, 'whatsapp'); }, 500);
}

async function instantStageUpdate(newStage) {
  if(!currentPhone) return;
  
  // Evrensel senkronizasyon: tüm view'lar + cache + lokal sheets
  syncStageToAllViews(currentPhone, newStage);
  
  // DB'ye kaydet → backend otomatik Google Sheets'e yazar
  await api('update-patient', 'POST', { phone: currentPhone, lead_stage: newStage });
  toast(`${(PIPELINE_STAGES[newStage] || {}).emoji || '✓'} ${(PIPELINE_STAGES[newStage] || {}).label || newStage}`, 'success');
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
    patient_type: 'Yerli',
    lead_stage: newStage
  };

  // Lokal listeyi anında güncelle (isim/not/bölüm de dahil)
  const idx = cachedConversations.findIndex(c => c.phone_number === currentPhone);
  if (idx > -1) {
    cachedConversations[idx].patient_name = newName;
    cachedConversations[idx].notes = newNotes;
    cachedConversations[idx].department = newDepartment;
  }
  
  // Evrensel stage senkronizasyonu (tüm view'lar + cache + lokal sheets)
  syncStageToAllViews(currentPhone, newStage);

  // API'ye kaydet → backend otomatik Google Sheets'e yazar
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
  if(!currentPhone || !confirm('Tüm geçmiş silinecek ve lead durumu sıfırlanacak. Onaylıyor musunuz?')) return;
  await api('delete-messages','POST',{phone:currentPhone});
  toast('Sohbet ve lead durumu tamamen sıfırlandı');
  document.getElementById('chat-messages').innerHTML = '<div class="empty">Sohbet temizlendi.</div>';
  
  // UI'yı da sıfırla
  document.getElementById('btn-status-bot').className = 'handover-btn active-bot';
  document.getElementById('btn-status-human').className = 'handover-btn';
  const stageSelect = document.getElementById('crm-stage');
  if (stageSelect) stageSelect.value = 'new';
  
  // Hasta Kartı arayüzünü (Sağ panel) temizle
  const deptArea = document.getElementById('dept-area');
  if (deptArea) deptArea.style.display = 'none';
  const notesDiv = document.getElementById('special-notes');
  if (notesDiv) {
    notesDiv.innerHTML = '';
    notesDiv.style.display = 'none';
  }
  const formAnswersBox = document.getElementById('form-answers-box');
  if (formAnswersBox) {
    formAnswersBox.innerHTML = '';
    document.getElementById('form-answers-wrapper').style.display = 'none';
  }
  document.getElementById('lead-score').textContent = '0 / 100';
  document.getElementById('lead-score-fill').style.width = '0%';
  document.getElementById('patient-score-badge').style.display = 'none';
  document.getElementById('patient-score-badge').className = 'score-badge bg-gray-500';
  document.getElementById('patient-score-badge').innerHTML = '<i class="fas fa-star" style="font-size:10px;"></i> 0p';
  
  // Local cache'i de temizle ki liste anında güncellensin
  const idx = cachedConversations.findIndex(c => c.phone_number === currentPhone);
  if (idx > -1) {
    cachedConversations[idx].status = 'active';
    cachedConversations[idx].lead_stage = 'new';
    cachedConversations[idx].phase = 'greeting';
    cachedConversations[idx].notes = null;
    cachedConversations[idx].tags = '[]';
    cachedConversations[idx].lead_score = 0;
    cachedConversations[idx].temperature = 'cold';
    cachedConversations[idx].message_count = 0;
    cachedConversations[idx].last_message = '';
    cachedConversations[idx].last_message_at = null;
    cachedConversations[idx]._effectiveStage = 'new';
  }
  
  // Listeyi ve tüm verileri sunucudan temiz şekilde çek ki UI senkronizasyonu şaşmasın
  loadConversations();
}

async function hardDeleteLead() {
  if(!currentPhone || !confirm('⚠️ DİKKAT! Bu hastanın TÜM form, log, mesaj ve randevu kayıtları veritabanından kalıcı olarak silinecek. SADECE test için kullanın. Onaylıyor musunuz?')) return;
  
  const deletingPhone = currentPhone;
  
  try {
    const result = await api('hard-delete-lead', 'POST', { phone: deletingPhone });
    console.log('Hard delete result:', result);
  } catch(e) {
    console.error('Hard delete API error:', e);
    toast('Silme işlemi başarısız oldu!', 'error');
    return;
  }
  
  toast('Kayıt tamamen yok edildi (Hard Reset)');
  
  // Sohbet alanını temizle
  document.getElementById('chat-messages').innerHTML = '<div class="empty">Kayıt silindi.</div>';
  document.getElementById('btn-status-bot').className = 'handover-btn active-bot';
  document.getElementById('btn-status-human').className = 'handover-btn';
  
  // Üst bar (chat header) temizle
  const chatTitle = document.getElementById('chat-title');
  if (chatTitle) chatTitle.textContent = '';
  const chatSubtitle = document.getElementById('chat-subtitle');
  if (chatSubtitle) chatSubtitle.textContent = '';
  
  // Hasta Kartını temizle
  const deptArea = document.getElementById('dept-area'); if (deptArea) deptArea.style.display = 'none';
  const notesDiv = document.getElementById('special-notes'); if (notesDiv) { notesDiv.innerHTML = ''; notesDiv.style.display = 'none'; }
  const formAnswersBox = document.getElementById('form-answers-box'); if (formAnswersBox) formAnswersBox.innerHTML = '';
  const faw = document.getElementById('form-answers-wrapper'); if (faw) faw.style.display = 'none';
  document.getElementById('lead-score').textContent = '0 / 100';
  document.getElementById('lead-score-fill').style.width = '0%';
  const scoreBadge = document.getElementById('patient-score-badge'); 
  if (scoreBadge) { scoreBadge.style.display = 'none'; }
  const stageSelect = document.getElementById('crm-stage'); if (stageSelect) stageSelect.value = 'new';
  const patientNameInput = document.getElementById('patient-name'); if (patientNameInput) patientNameInput.value = '';

  // Listeden çıkar ve currentPhone'u sıfırla
  cachedConversations = cachedConversations.filter(c => c.phone_number !== deletingPhone);
  currentPhone = null;
  renderConversationList();
  
  // Sunucudan listeyi tümüyle yeniden çek
  setTimeout(loadConversations, 300);
}

async function clearAllAppointments() {
  if(!confirm('Gelen randevu/ön görüşme taleplerinin tümü silinecektir. Test aşamasındaysanız onaylayın.')) return;
  await api('clear-appointments', 'POST');
  toast('Tüm talepler sıfırlandı.');
  loadAppointments();
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
        <div>
          <div style="font-size:18px;font-weight:700;">${escapeHtml(nm)}</div>
          <div style="display:flex;gap:10px;margin-top:4px;flex-wrap:wrap;align-items:center;">
            <span style="font-size:12px;color:var(--text-muted);">📱 ${escapeHtml(e.phone_number)}</span>
            ${e.city?`<span style="font-size:12px;color:var(--text-muted);">📍 ${escapeHtml(e.city)}</span>`:''}
            ${e.email?`<span style="font-size:12px;color:var(--text-muted);">✉️ ${escapeHtml(e.email)}</span>`:''}
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

