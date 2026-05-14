// ==========================================
// QUBA AI — AI Module Registry (Plugin System)
// Modüler AI pipeline — tenant bazlı özelleştirme
// ==========================================

/**
 * Her AI modülü bu interface'i implemente eder
 * Modüller sırayla çalışır: preProcess → processMessage → postProcess
 */

// Modül tipleri
export const MODULE_TYPES = {
  PREPROCESSOR: 'preprocessor',     // Mesaj geldiğinde (dil tespiti, spam filtre, vb.)
  PROMPT_BUILDER: 'prompt_builder',  // System prompt oluşturma
  RESPONSE_FILTER: 'response_filter', // AI cevabını filtrele (banned words, format, vb.)
  ANALYTICS: 'analytics',           // Lead scoring, sentiment analizi
  ESCALATION: 'escalation',         // Handover kararı
};

// Modül tanımı
export const AI_MODULES = {
  // ==========================================
  // PREPROCESSORS
  // ==========================================
  'language-detector': {
    id: 'language-detector',
    name: 'Dil Tespiti',
    description: 'Gelen mesajın dilini Unicode + pattern matching ile tespit eder',
    type: MODULE_TYPES.PREPROCESSOR,
    version: '1.0',
    defaultEnabled: true,
    configSchema: {},
  },
  'spam-filter': {
    id: 'spam-filter',
    name: 'Spam Filtresi',
    description: 'Bot, reklam ve spam mesajları tespit ederek filtreler',
    type: MODULE_TYPES.PREPROCESSOR,
    version: '1.0',
    defaultEnabled: true,
    configSchema: {
      sensitivity: { type: 'select', options: ['low', 'medium', 'high'], default: 'medium' },
    },
  },
  'working-hours': {
    id: 'working-hours',
    name: 'Mesai Saati Kontrolü',
    description: 'Mesai dışında otomatik mesaj gönderir',
    type: MODULE_TYPES.PREPROCESSOR,
    version: '1.0',
    defaultEnabled: true,
    configSchema: {
      start: { type: 'text', default: '09:00' },
      end: { type: 'text', default: '18:00' },
      weekend: { type: 'boolean', default: false },
      message: { type: 'textarea', default: 'Mesai saatlerimiz dışındasınız. En kısa sürede dönüş yapılacaktır.' },
    },
  },

  // ==========================================
  // PROMPT BUILDERS
  // ==========================================
  'industry-prompt': {
    id: 'industry-prompt',
    name: 'Sektör Prompt Üretici',
    description: 'Sektöre göre özelleştirilmiş AI system prompt üretir',
    type: MODULE_TYPES.PROMPT_BUILDER,
    version: '1.0',
    defaultEnabled: true,
    configSchema: {},
  },
  'conversation-memory': {
    id: 'conversation-memory',
    name: 'Konuşma Hafızası',
    description: 'Önceki mesajları AI context\'ine ekler (kısa ve uzun dönem)',
    type: MODULE_TYPES.PROMPT_BUILDER,
    version: '1.0',
    defaultEnabled: true,
    configSchema: {
      shortTermLimit: { type: 'number', default: 20 },
    },
  },
  'phase-manager': {
    id: 'phase-manager',
    name: 'Konuşma Fazı Yönetimi',
    description: 'Greeting → Consultation → Closing akışını yönetir',
    type: MODULE_TYPES.PROMPT_BUILDER,
    version: '1.0',
    defaultEnabled: true,
    configSchema: {
      phases: { type: 'json', default: ['greeting', 'discovery', 'consultation', 'closing', 'followup'] },
    },
  },

  // ==========================================
  // RESPONSE FILTERS
  // ==========================================
  'banned-words': {
    id: 'banned-words',
    name: 'Yasaklı Kelime Filtresi',
    description: 'AI cevabında yasaklı kelimeler varsa temizler',
    type: MODULE_TYPES.RESPONSE_FILTER,
    version: '1.0',
    defaultEnabled: false,
    configSchema: {
      words: { type: 'textarea', default: '' },
    },
  },
  'message-formatter': {
    id: 'message-formatter',
    name: 'Mesaj Formatlama',
    description: 'WhatsApp/Instagram formatına uygun mesaj düzenleme',
    type: MODULE_TYPES.RESPONSE_FILTER,
    version: '1.0',
    defaultEnabled: true,
    configSchema: {
      maxLength: { type: 'number', default: 1000 },
      emojiLimit: { type: 'number', default: 3 },
    },
  },

  // ==========================================
  // ANALYTICS
  // ==========================================
  'lead-scorer': {
    id: 'lead-scorer',
    name: 'Lead Puanlama',
    description: 'Konuşma analizine göre müşteri potansiyeli puanlar',
    type: MODULE_TYPES.ANALYTICS,
    version: '1.0',
    defaultEnabled: true,
    configSchema: {},
  },
  'sentiment-analyzer': {
    id: 'sentiment-analyzer',
    name: 'Duygu Analizi',
    description: 'Müşteri mesajlarının duygusal tonunu analiz eder',
    type: MODULE_TYPES.ANALYTICS,
    version: '1.0',
    defaultEnabled: false,
    configSchema: {},
  },

  // ==========================================
  // ESCALATION
  // ==========================================
  'auto-handover': {
    id: 'auto-handover',
    name: 'Otomatik İnsan Devir',
    description: 'Belirli koşullarda konuşmayı insana aktarır',
    type: MODULE_TYPES.ESCALATION,
    version: '1.0',
    defaultEnabled: true,
    configSchema: {
      maxBotMessages: { type: 'number', default: 8 },
      triggerKeywords: { type: 'textarea', default: 'insan, müdür, şikayet, avukat' },
    },
  },
};

// Tip tanımları
export type ModuleId = keyof typeof AI_MODULES;
export type ModuleConfig = Record<string, any>;
export type ModuleType = typeof MODULE_TYPES[keyof typeof MODULE_TYPES];

// Tenant modül yapılandırması
export interface TenantModuleConfig {
  moduleId: ModuleId;
  enabled: boolean;
  config: ModuleConfig;
}

/**
 * Tenant'ın aktif modüllerini getir (DB'den veya default)
 */
export function getDefaultModules(): TenantModuleConfig[] {
  return Object.values(AI_MODULES).map((m) => ({
    moduleId: m.id as ModuleId,
    enabled: m.defaultEnabled,
    config: Object.fromEntries(
      Object.entries(m.configSchema).map(([key, schema]: [string, any]) => [key, schema.default])
    ),
  }));
}

/**
 * Modülleri tipe göre filtrele
 */
export function getModulesByType(modules: TenantModuleConfig[], type: ModuleType): TenantModuleConfig[] {
  return modules.filter(
    (m) => m.enabled && AI_MODULES[m.moduleId]?.type === type
  );
}
