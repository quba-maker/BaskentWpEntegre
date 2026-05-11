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

  // Initialize mobile view based on URL hash or default
  if (window.innerWidth <= 768) {
    const layout = document.querySelector('.inbox-layout');
    if (layout) {
      layout.setAttribute('data-mobile-view', 'list');
    }
    // Handle hardware back button
    window.addEventListener('popstate', (e) => {
      if (e.state) {
        if (e.state.mobileView) navigateMobileView(e.state.mobileView, true);
        if (e.state.aptView) navigateMobileAptView(e.state.aptView, true);
        if (e.state.formView) navigateMobileFormView(e.state.formView, true);
      } else {
        // Fallbacks
        navigateMobileView('list', true);
        navigateMobileAptView('list', true);
        navigateMobileFormView('list', true);
      }
    });
  }
});

// 📱 Native Mobile Stack Navigation Logic (Chat)
window.mobileView = 'list';
function navigateMobileView(view, isPopState = false) {
  if (window.innerWidth > 768) return; // Only apply on mobile
  
  const layout = document.querySelector('.inbox-layout');
  if (!layout) return;
  
  layout.setAttribute('data-mobile-view', view);
  document.body.setAttribute('data-mobile-view', view);
  window.mobileView = view;
  
  // History API Integration for Hardware Back Button
  if (!isPopState) {
    if (view === 'list') history.pushState({ mobileView: 'list' }, '', '#chat-list');
    else if (view === 'chat') history.pushState({ mobileView: 'chat' }, '', '#chat-view');
    else if (view === 'crm') history.pushState({ mobileView: 'crm' }, '', '#chat-crm');
  }
}

// 📱 Native Mobile Stack Navigation Logic (Appointments)
window.aptView = 'list';
function navigateMobileAptView(view, isPopState = false) {
  if (window.innerWidth > 768) return; // Only apply on mobile
  
  const layout = document.querySelector('.apt-inbox-layout');
  if (!layout) return;
  
  layout.setAttribute('data-mobile-view', view);
  window.aptView = view;
  
  if (!isPopState) {
    if (view === 'list') history.pushState({ aptView: 'list' }, '', '#apt-list');
    else if (view === 'detail') history.pushState({ aptView: 'detail' }, '', '#apt-detail');
  }
}

// 📱 Native Mobile Stack Navigation Logic (Forms)
window.formView = 'list';
function navigateMobileFormView(view, isPopState = false) {
  if (window.innerWidth > 768) {
    // Desktop behavior fallback
    if (view === 'list') goBackToForms();
    return;
  }
  
  document.body.setAttribute('data-form-view', view);
  window.formView = view;
  
  // Make sure both pages are active in DOM so CSS can animate them
  document.getElementById('page-form-management').classList.add('active');
  document.getElementById('page-form-detail').classList.add('active');
  document.getElementById('page-form-management').style.display = '';
  document.getElementById('page-form-detail').style.display = '';
  
  if (!isPopState) {
    if (view === 'list') history.pushState({ formView: 'list' }, '', '#form-list');
    else if (view === 'detail') history.pushState({ formView: 'detail' }, '', '#form-detail');
  }
}

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

const navButtons = document.querySelectorAll('.nav-btn, .mobile-tab-btn[data-page]');
navButtons.forEach(b => {
  b.addEventListener('click', () => {
    // Tüm butonlardan active kaldır
    navButtons.forEach(x => x.classList.remove('active'));
    
    document.querySelectorAll('.page').forEach(x => {
      x.classList.remove('active');
      x.style.display = ''; // Manuel display stillerini sıfırla (form-detail vb.)
    });
    
    // Hem sidebar hem tab bar'daki ilgili butonları active yap
    const targetPage = b.dataset.page;
    if (targetPage) {
      document.querySelectorAll(`.nav-btn[data-page="${targetPage}"], .mobile-tab-btn[data-page="${targetPage}"]`).forEach(btn => {
        btn.classList.add('active');
      });
      document.getElementById('page-' + targetPage).classList.add('active');
    }
    
    // Mobilde sidebar'dan tıklandıysa menüyü kapat
    if (window.innerWidth <= 768) {
      document.querySelector('.sidebar').classList.remove('open');
    }
    
    // Form management'a dönüşte listeyi göster
    if (b.dataset.page === 'form-management') {
      if (window.innerWidth <= 768) {
        navigateMobileFormView('list');
      } else {
        document.getElementById('page-form-detail').style.display = 'none';
        document.getElementById('page-form-management').style.display = 'block';
      }
    }
    
    // Appointments'a geçişte listeyi göster
    if (b.dataset.page === 'appointments' && window.innerWidth <= 768) {
      navigateMobileAptView('list');
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
  try {
    return await r.json();
  } catch(e) {
    console.error('API Parse Error:', e);
    return null;
  }
}

