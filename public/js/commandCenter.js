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
  const token = localStorage.getItem('panel_auth') || '';
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

