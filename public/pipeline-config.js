/**
 * PIPELINE_STAGES — Tüm CRM'in tek kaynak noktası (Single Source of Truth)
 * 
 * Her yerde bu config kullanılır:
 * - Inbox badge'leri
 * - Kanban sütunları
 * - Form detay paneli
 * - Bot faz geçişleri
 * - Google Sheets senkronizasyonu
 */
const PIPELINE_STAGES = {
  new:         { label: 'Yeni Lead',       emoji: '🆕', color: '#8b5cf6', sheetsVal: 'CREATED',           botPhase: null,        order: 0 },
  contacted:   { label: 'İlk Temas',       emoji: '📞', color: '#3b82f6', sheetsVal: 'İletişime Geçildi', botPhase: 'greeting',   order: 1 },
  discovery:   { label: 'Analiz',           emoji: '🩺', color: '#06b6d4', sheetsVal: 'Bilgi Toplama',     botPhase: 'discovery',  order: 2 },
  negotiation: { label: 'İkna',            emoji: '🏛️', color: '#f59e0b', sheetsVal: 'İkna Ediliyor',     botPhase: 'trust',      order: 3 },
  hot_lead:    { label: 'Sıcak Lead',       emoji: '🔥', color: '#ef4444', sheetsVal: 'Sıcak Lead',        botPhase: 'handover',   order: 4 },
  appointed:   { label: 'Randevu Alındı',  emoji: '✅', color: '#22c55e', sheetsVal: 'Randevu Aldı',      botPhase: null,         order: 5 },
  lost:        { label: 'Kaybedildi',       emoji: '❌', color: '#6b7280', sheetsVal: 'Soğuk',             botPhase: null,         order: 6 }
};

// Ters haritalama: Sheets değerinden DB stage'ine
const SHEETS_TO_STAGE = {};
Object.entries(PIPELINE_STAGES).forEach(([stage, config]) => {
  SHEETS_TO_STAGE[config.sheetsVal] = stage;
});
// Eski Sheets değerleri için geriye uyumluluk
Object.assign(SHEETS_TO_STAGE, {
  '': 'new',
  'Cevap Verdi': 'discovery',
  'İlgili': 'discovery',
  'SİSTEME ALINDI ✅': 'contacted',
  'Geldi': 'appointed',
  'Tedavi Oldu': 'appointed',
  'appointment_request': 'hot_lead',
  'responded': 'discovery'
});

// Bot fazından stage'e haritalama
const BOT_PHASE_TO_STAGE = {
  greeting: 'contacted',
  discovery: 'discovery',
  trust: 'negotiation',
  handover: 'hot_lead'
};

// Stage badge HTML üreteci
function getStageBadge(stage) {
  const s = PIPELINE_STAGES[stage] || PIPELINE_STAGES.new;
  return `<span style="background:${s.color}22; color:${s.color}; border:1px solid ${s.color}44; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:600; white-space:nowrap;">${s.emoji} ${s.label}</span>`;
}

// Kanban sütun grupları (5 sütun — new+contacted birleşik, lost gizli)
const KANBAN_COLUMNS = [
  { key: 'new_contacted', title: '🆕 Yeni & İlk Temas', stages: ['new', 'contacted'], color: '#8b5cf6' },
  { key: 'discovery',     title: '🩺 Analiz',            stages: ['discovery'],         color: '#06b6d4' },
  { key: 'negotiation',   title: '🏛️ İkna',             stages: ['negotiation'],       color: '#f59e0b' },
  { key: 'hot_lead',      title: '🔥 Sıcak Lead',        stages: ['hot_lead'],          color: '#ef4444' },
  { key: 'appointed',     title: '✅ Randevu Alındı',    stages: ['appointed'],         color: '#22c55e' }
];
