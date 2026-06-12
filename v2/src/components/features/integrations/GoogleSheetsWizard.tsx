import React, { useState, useEffect, useCallback } from 'react';
import { IntegrationWizard, WizardStep } from './IntegrationWizard';
import { 
  FileSpreadsheet, CheckCircle2, Loader2, AlertTriangle,
  Columns, ExternalLink, Bot, MessageCircle, Save,
  BrainCircuit, Settings2, Link2, Copy, RefreshCw
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useParams } from 'next/navigation';
import { 
  fetchGoogleSheetsTabs, 
  saveGoogleSheetsConfig, 
  getGoogleSheetsConfig,
  rotateGoogleSheetsWebhookSecret
} from '@/app/actions/integrations';
import { getBotListForDropdown } from '@/app/actions/integrations';

// Parse spreadsheet ID from URL or raw ID
function parseSpreadsheetId(input: string): string {
  if (!input) return '';
  // Handle full URL: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit...
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // Handle raw ID
  return input.trim();
}

interface AppsScriptSnippetProps {
  webhookUrl: string;
  tenantSlug: string;
  secret: string;
  sheetName: string;
}

function AppsScriptSnippet({ webhookUrl, tenantSlug, secret, sheetName }: AppsScriptSnippetProps) {
  const [copied, setCopied] = useState(false);

  const cleanWebhookUrl = webhookUrl.split('?')[0];

  const code = `// Google Sheets Webhook & Auto-Sync Entegrasyonu
const WEBHOOK_URL = "${cleanWebhookUrl}";
const TENANT_SLUG = "${tenantSlug}";
const WEBHOOK_SECRET = "${secret || 'PASTE_SECRET_HERE'}";
const FORM_SHEET_NAME = "${sheetName}";

// ═══════════════════════════════════════════════════════
// AUTOMATIC TRIGGER SETUP (RUN THIS ONCE)
// ═══════════════════════════════════════════════════════

// Bu fonksiyonu editörde seçip "Çalıştır" (Run) butonuna basmanız yeterlidir.
function setupQubaTriggers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Temizlik yap
  removeQubaTriggers();
  
  // 2. onFormSubmit tetikleyicisi (Form Gönderildiğinde çalışır - anlık)
  ScriptApp.newTrigger("onFormSubmit")
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
    
  // 3. catchUpSync tetikleyicisi (Periyodik kontrol - 15 dakikada bir)
  ScriptApp.newTrigger("catchUpSync")
    .timeBased()
    .everyMinutes(15)
    .create();
    
  Logger.log("✓ Quba tetikleyicileri kuruldu:");
  Logger.log("- onFormSubmit (Anlık Form Gönderimi)");
  Logger.log("- catchUpSync (Zamanlayıcı: 15 dakikada bir)");
  
  // 4. Bağlantı Testini Çalıştır
  testQubaConnection();
}

// Quba tetikleyicilerini temizleme
function removeQubaTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var count = 0;
  for (var i = 0; i < triggers.length; i++) {
    var fnName = triggers[i].getHandlerFunction();
    if (fnName === "onFormSubmit" || fnName === "catchUpSync") {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }
  Logger.log("✓ Eski Quba tetikleyicileri temizlendi (Sayı: " + count + ").");
}

// ═══════════════════════════════════════════════════════
// WEBHOOK & CRON HANDLERS
// ═══════════════════════════════════════════════════════

// Anlık form gönderimlerini yakalar
function onFormSubmit(e) {
  try {
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();
    
    // Sadece seçili sekmeyi işle
    if (sheetName !== FORM_SHEET_NAME) {
      Logger.log("Farklı sekme (" + sheetName + "), işlem atlandı.");
      return;
    }
    
    var rowNumber = e.range.getRow();
    var lastCol = sheet.getLastColumn();
    
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function(h) { return String(h).trim(); });
    var values = sheet.getRange(rowNumber, 1, 1, lastCol).getValues()[0]
      .map(function(v) { return String(v || ''); });
    
    var payload = {
      event_type: 'form_submit',
      sheet_name: sheetName,
      row_number: rowNumber,
      headers: headers,
      values: values,
      timestamp: new Date().toISOString(),
      tenant_slug: TENANT_SLUG
    };
    
    sendToQuba('/sheets-webhook', payload, false);
  } catch (err) {
    Logger.log("onFormSubmit Hatası: " + err.toString());
  }
}

// 15 dakikada bir yedek tarama tetikler
function catchUpSync() {
  try {
    var payload = {
      trigger: 'time_driven_catchup',
      tenant_slug: TENANT_SLUG,
      timestamp: new Date().toISOString()
    };
    sendToQuba('/cron-form-sync', payload, false);
  } catch (err) {
    Logger.log("catchUpSync Hatası: " + err.toString());
  }
}

// Bağlantı Doğrulama Testi (Dry-Run)
function testQubaConnection() {
  Logger.log("Quba bağlantısı test ediliyor...");
  var payload = {
    trigger: 'health_ping',
    tenant_slug: TENANT_SLUG,
    timestamp: new Date().toISOString()
  };
  sendToQuba('/cron-form-sync', payload, true);
}

// ═══════════════════════════════════════════════════════
// HTTP & SECURITY HELPERS
// ═══════════════════════════════════════════════════════

function buildQubaUrl(endpoint, params) {
  var baseUrl = WEBHOOK_URL.split('?')[0].replace(/\/$/, '');
  var url = baseUrl.replace(/\/sheets-webhook$/, endpoint);
  var query = Object.keys(params)
    .map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    })
    .join('&');

  return url + '?' + query;
}

function sendToQuba(endpoint, payload, isDryRun) {
  var params = { tenant: TENANT_SLUG };
  if (isDryRun) {
    params.dryRun = 'true';
  }
  var targetUrl = buildQubaUrl(endpoint, params);

  var bodyStr = JSON.stringify(payload);
  var timestamp = Math.floor(Date.now() / 1000).toString();
  
  // HMAC SHA256 İmzası Üret
  var signatureData = timestamp + '.' + bodyStr;
  var signature = 'sha256=' + computeHmacSha256(WEBHOOK_SECRET, signatureData);

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-sheets-signature': signature,
      'x-sheets-timestamp': timestamp
    },
    payload: bodyStr,
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(targetUrl, options);
    var code = response.getResponseCode();
    var text = response.getContentText();
    
    if (code >= 200 && code < 300) {
      if (isDryRun) {
        Logger.log("✓ Quba bağlantı testi başarılı! Sunucu yanıtı: " + text);
      } else {
        Logger.log("✓ İstek başarıyla gönderildi (HTTP " + code + ")");
      }
    } else {
      Logger.log("❌ İstek başarısız oldu (HTTP " + code + "): " + text);
    }
  } catch (err) {
    Logger.log("❌ Gönderim hatası: " + err.toString());
  }
}

function computeHmacSha256(secret, data) {
  var signatureBytes = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    data,
    secret
  );
  
  var signature = '';
  for (var i = 0; i < signatureBytes.length; i++) {
    var byteVal = signatureBytes[i];
    if (byteVal < 0) byteVal += 256;
    var byteString = byteVal.toString(16);
    if (byteString.length === 1) byteString = '0' + byteString;
    signature += byteString;
  }
  return signature;
}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4 mt-4 border-t pt-4 border-gray-100">
      {/* Kurulum Adımları */}
      <div className="bg-slate-50 border border-slate-200/60 p-4 rounded-xl space-y-3">
        <h5 className="text-[12px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <Settings2 className="w-3.5 h-3.5 text-slate-500" /> Apps Script Otomatik Kurulum Adımları
        </h5>
        <p className="text-[12px] text-slate-500 leading-relaxed font-medium">
          Otomatik senkronizasyon için sunucu tarafında periyodik Vercel cron tanımları gerekmez. Quba, verileri Google Sheets tetikleyicileriyle (event-driven) çeker. Kurulum adımları son derece basittir:
        </p>
        <ol className="text-[12px] text-slate-600 space-y-2.5 list-decimal list-inside leading-relaxed font-medium">
          <li>
            <strong>Gizli Anahtarı Üretin:</strong> Yukarıdaki <code>"Gizli Anahtarı Yenile"</code> butonuna basın ve üretilen gerçek gizli anahtarı <strong>hemen kopyalayın</strong> (güvenlik sebebiyle bu değer sadece bir kez gösterilir).
          </li>
          <li>
            <strong>Şablon Kodunu Kopyalayın:</strong> Aşağıdaki <code>"Kodu Kopyala"</code> butonuyla otomatik hazırlanan şablon kodunu kopyalayın.
          </li>
          <li>
            <strong>Editörü Açın:</strong> Google Sheet tablonuzda üst menüden <code>Uzantılar (Extensions) &rarr; Apps Script</code> yolunu izleyin, editördeki tüm mevcut kodları temizleyin ve kopyaladığınız yeni kodu buraya yapıştırın.
          </li>
          <li>
            <strong>Gizli Anahtarı Tanımlayın:</strong> Yapıştırdığınız kodun en üstünde yer alan <code>WEBHOOK_SECRET = "..."</code> kısmına kopyaladığınız gerçek gizli anahtarı yapıştırın.
          </li>
          <li>
            <strong>Otomatik Tetikleyicileri Kurun:</strong> Kod editörünün üstündeki fonksiyon listesinden <code>setupQubaTriggers</code> fonksiyonunu seçin ve <strong>"Çalıştır" (Run)</strong> butonuna basın. Tetikleyiciler arka planda kurulacaktır:
            <ul className="list-disc list-inside pl-4 mt-1.5 space-y-1 text-slate-500 text-[11px]">
              <li><strong>Anlık Aktarım (onFormSubmit):</strong> Form e-tabloya düştüğü anda anlık olarak panele aktarılır.</li>
              <li><strong>Yedek Kontrol (catchUpSync):</strong> Yaklaşık 15 dakikada bir otomatik yedek tarama yapılır.</li>
            </ul>
          </li>
          <li>
            <strong>Yetkilendirmeyi Onaylayın:</strong> İlk çalıştırmada sizden istenecek standart Google hesap izinlerini onaylayın. Apps Script ekranının altındaki günlüklerden bağlantı testinin başarılı olduğunu izleyebilirsiniz.
          </li>
        </ol>
      </div>

      <div className="flex items-center justify-between mt-2">
        <span className="text-[12px] font-bold text-gray-500 uppercase tracking-wider">
          Apps Script Şablonu
        </span>
        <button
          onClick={handleCopy}
          className="px-3 py-1 rounded-lg text-[11px] font-bold border border-gray-200 hover:bg-gray-50 flex items-center gap-1 text-gray-700 transition-colors"
        >
          {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Kopyalandı' : 'Kodu Kopyala'}
        </button>
      </div>
      <div className="relative">
        <pre className="text-[11px] font-mono p-4 bg-gray-950 text-gray-100 rounded-xl overflow-x-auto max-h-[200px] border border-gray-800 leading-relaxed">
          {code}
        </pre>
      </div>
      <p className="text-[10px] text-amber-600 font-medium bg-amber-50 border border-amber-100 p-2.5 rounded-lg leading-relaxed">
        ⚠️ <strong>Önemli:</strong> Google Sheet sekme adını değiştirirseniz Apps Script içindeki <code>FORM_SHEET_NAME</code> değerini de güncellemeyi unutmayın.
      </p>
    </div>
  );
}

export function GoogleSheetsWizard({ isOpen, onClose, onComplete }: { isOpen: boolean, onClose: () => void, onComplete: () => void }) {
  
  // ── Core State ──
  const [spreadsheetInput, setSpreadsheetInput] = useState('');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [tabs, setTabs] = useState<{ id: number; title: string }[]>([]);
  const [selectedTabs, setSelectedTabs] = useState<string[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState('');
  
  // ── Routing Config ──
  const [bots, setBots] = useState<{ id: string; displayName: string; color: string }[]>([]);
  const [channels, setChannels] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [selectedBotId, setSelectedBotId] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  
  // ── Save State ──
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Webhook & Secret Rotation State ──
  const params = useParams();
  const tenantSlug = (params?.tenant_slug as string) || '';

  const [webhookSecretMasked, setWebhookSecretMasked] = useState('');
  const [rawSecret, setRawSecret] = useState('');
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [copiedField, setCopiedField] = useState<'url' | 'secret' | null>(null);
  const [rotateError, setRotateError] = useState('');

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/sheets-webhook?tenant=${tenantSlug}`
    : '';

  const handleCopy = (text: string, field: 'url' | 'secret') => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => {
      setCopiedField(null);
    }, 2000);
  };

  async function handleRotateSecret() {
    setRotating(true);
    setRotateError('');
    try {
      const res = await rotateGoogleSheetsWebhookSecret();
      if (res.success && res.webhookSecretRaw) {
        setRawSecret(res.webhookSecretRaw);
        setWebhookSecretMasked(`wh_sec_${res.webhookSecretRaw.substring(0, 4)}...${res.webhookSecretRaw.substring(res.webhookSecretRaw.length - 4)}`);
        setShowRotateConfirm(false);
      } else {
        setRotateError(res.error || 'Secret rotasyonu başarısız oldu.');
      }
    } catch (e: any) {
      setRotateError(e?.message || 'Bir hata oluştu.');
    } finally {
      setRotating(false);
    }
  }
  
  // ── Load existing config + bots on open ──
  useEffect(() => {
    if (!isOpen) return;
    
    (async () => {
      // Load bots
      const botRes = await getBotListForDropdown();
      if (botRes.success && botRes.bots) {
        setBots(botRes.bots);
      }
      
      // Load existing config + pipeline routing
      const cfgRes = await getGoogleSheetsConfig();
      let existingOutboundId = '';
      let existingGreetingId = '';
      if (cfgRes.success && cfgRes.config) {
        const cfg = cfgRes.config as any;
        if (cfg.spreadsheetId) {
          setSpreadsheetInput(cfg.spreadsheetId);
          setSpreadsheetId(cfg.spreadsheetId);
        }
        if (cfg.activeSheets?.length) {
          setSelectedTabs(cfg.activeSheets);
        }
        if (cfg.webhookSecretMasked) {
          setWebhookSecretMasked(cfg.webhookSecretMasked);
        }
        // Pipeline routing from config response
        if (cfg.outbound_channel_id) existingOutboundId = cfg.outbound_channel_id;
        if (cfg.greeting_group_id) existingGreetingId = cfg.greeting_group_id;
      }
      
      // Load WhatsApp channels for outbound selection
      try {
        const { getIntegrationHealth } = await import('@/app/actions/integrations');
        const healthRes = await getIntegrationHealth();
        if (healthRes.success && healthRes.channels) {
          // Include any WhatsApp channel (connected or warning — both can send outbound)
          const waChannels = (healthRes.channels as any[]).filter(
            (c: any) => c.provider === 'whatsapp'
          );
          setChannels(waChannels.map((c: any) => ({ id: c.id, name: c.name, provider: c.provider })));
          // Pre-select existing outbound or first available
          if (existingOutboundId && waChannels.some((c: any) => c.id === existingOutboundId)) {
            setSelectedChannelId(existingOutboundId);
          } else if (waChannels.length > 0 && !selectedChannelId) {
            setSelectedChannelId(waChannels[0].id);
          }
        }
      } catch (e) {
        console.warn('[GSW] Failed to load channels:', e);
      }
      
      // Pre-select bot: existing greeting or first WA bot
      if (existingGreetingId && botRes.success && botRes.bots?.some((b: any) => b.id === existingGreetingId)) {
        setSelectedBotId(existingGreetingId);
      } else if (botRes.success && botRes.bots && botRes.bots.length > 0 && !selectedBotId) {
        setSelectedBotId(botRes.bots[0].id);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Fetch Tabs ──
  async function handleFetchTabs() {
    const id = parseSpreadsheetId(spreadsheetInput);
    if (!id) {
      setTabsError('Geçerli bir Spreadsheet ID veya link girin');
      return;
    }
    setSpreadsheetId(id);
    setTabsLoading(true);
    setTabsError('');
    setTabs([]);
    
    const res = await fetchGoogleSheetsTabs(id);
    setTabsLoading(false);
    
    if (res.success && res.tabs) {
      setTabs(res.tabs);
      // Auto-select recommended tab if none selected
      if (res.tabs.length > 0 && selectedTabs.length === 0) {
        const recommendedKeywords = ['form yanıtları', 'form responses', 'form yanitlari', 'responses', 'yanıtlar', 'yanitlar'];
        const matchedTab = res.tabs.find((t: any) => 
          recommendedKeywords.some(keyword => t.title.toLowerCase().includes(keyword))
        );
        if (matchedTab) {
          setSelectedTabs([matchedTab.title]);
        } else {
          setSelectedTabs([res.tabs[0].title]);
        }
      }
    } else {
      setTabsError(res.error || 'Sheet okunamadı — paylaşım ayarlarını kontrol edin');
    }
  }
  
  function toggleTab(title: string) {
    setSelectedTabs(prev => 
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  }

  // ── Save Config ──
  async function handleSave() {
    setSaving(true);
    setSaveError('');
    
    try {
      const res = await saveGoogleSheetsConfig({
        spreadsheetId,
        activeSheets: selectedTabs,
        outbound_channel_id: selectedChannelId || undefined,
        greeting_group_id: selectedBotId || undefined,
      });
      
      if (!res.success) {
        setSaveError(res.error || 'Google Sheets yapılandırması kaydedilemedi');
        setSaving(false);
        return;
      }
      
      setSaveSuccess(true);
      setSaving(false);
      
      // Auto-close wizard after success feedback (1.5s)
      setTimeout(() => {
        onComplete();
      }, 1500);
    } catch (err) {
      console.error('[GSW] Save error:', err);
      setSaveError('Google Sheets yapılandırması kaydedilemedi. Lütfen tekrar deneyin.');
      setSaving(false);
    }
  }
  
  // ── Handle Finish ──
  function handleFinish() {
    onComplete();
  }

  // ═══════════════════════════════════════════
  // STEP 1: Spreadsheet Connection
  // ═══════════════════════════════════════════
  const Step1Connect = (
    <div className="space-y-5">
      <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl">
        <div className="flex items-start gap-3">
          <Link2 className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-[14px] font-bold text-blue-900 mb-1">Google Sheets Bağlantısı</h4>
            <p className="text-[12px] text-blue-700">
              Sheet linkini veya Spreadsheet ID'sini yapıştırın. Sheet'in <strong>"Bağlantısı olan herkes"</strong> paylaşımının açık olması gerekir.
            </p>
          </div>
        </div>
      </div>
      
      <div>
        <label className="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">
          Spreadsheet Link / ID
        </label>
        <div className="flex gap-2">
          <input
            value={spreadsheetInput}
            onChange={e => setSpreadsheetInput(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/... veya Spreadsheet ID"
            className="flex-1 px-4 py-3 rounded-xl border text-[14px] font-medium outline-none focus:ring-2 focus:ring-blue-200 transition-all"
            style={{ borderColor: 'var(--q-border-default)' }}
          />
          <button
            onClick={handleFetchTabs}
            disabled={tabsLoading || !spreadsheetInput.trim()}
            className="px-5 py-3 rounded-xl text-white text-[13px] font-bold flex items-center gap-2 disabled:opacity-50 transition-all hover:opacity-90"
            style={{ backgroundColor: '#0F9D58' }}
          >
            {tabsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Bağlan
          </button>
        </div>
        {tabsError && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
            <p className="text-[12px] font-medium text-rose-700">{tabsError}</p>
          </div>
        )}
        {spreadsheetId && tabs.length > 0 && (
          <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <p className="text-[12px] font-bold text-emerald-700">
              Bağlantı başarılı — {tabs.length} sekme bulundu
            </p>
          </div>
        )}
      </div>
      
      {spreadsheetId && (
        <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: 'var(--q-text-secondary)' }}>
          <span>ID: {spreadsheetId.slice(0, 20)}...</span>
          <a 
            href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-blue-600 hover:underline"
          >
            Aç <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Webhook & Secret Rotation Section */}
      <div className="border-t pt-5 mt-6 border-gray-100 space-y-4">
        <h4 className="text-[14px] font-bold flex items-center gap-1.5" style={{ color: 'var(--q-text-primary)' }}>
          <BrainCircuit className="w-4 h-4 text-indigo-500" /> Otomatik Tetikleyici Kurulumu
        </h4>
        <div className="bg-indigo-50/50 border border-indigo-100 p-4 rounded-xl space-y-2">
          <p className="text-[12px] text-indigo-950 font-semibold leading-relaxed">
            ⚡ Otomatik senkronizasyon için sunucu tarafında periyodik Vercel cron tanımları veya QStash gerekmez. Quba, verileri Google Sheets tetikleyicileriyle (event-driven) çeker.
          </p>
          <p className="text-[12px] text-indigo-800 leading-relaxed font-medium">
            Aşağıdaki hazır Apps Script şablon kodunu kopyalayıp e-tablonuza yapıştırın ve <strong>setupQubaTriggers()</strong> fonksiyonunu bir kez çalıştırın. Sistem tetikleyicileri otomatik kuracaktır:
          </p>
          <ul className="text-[11px] text-indigo-700 space-y-1 font-semibold list-disc list-inside">
            <li>Anlık Aktarım: Yeni form e-tabloya düştüğü anda anlık olarak panele aktarılır.</li>
            <li>Yedek Kontrol: Yaklaşık 15 dakikada bir otomatik yedek senkronizasyon yapılır.</li>
            <li>Kullanıcının herhangi bir manuel tetikleyici / zaman seçimi yapması gerekmez.</li>
          </ul>
        </div>

        {/* Tenant Slug Field */}
        <div>
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
            Tenant Slug
          </label>
          <input
            readOnly
            value={tenantSlug}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            className="w-full px-3 py-2.5 rounded-lg border text-[13px] font-mono bg-gray-50 text-gray-600 outline-none"
            style={{ borderColor: 'var(--q-border-default)' }}
          />
        </div>

        {/* Webhook URL Field */}
        <div>
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
            Webhook URL
          </label>
          <div className="flex gap-2">
            <input
              readOnly
              value={webhookUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="flex-1 px-3 py-2.5 rounded-lg border text-[13px] font-mono bg-gray-50 text-gray-600 outline-none"
              style={{ borderColor: 'var(--q-border-default)' }}
            />
            <button
              onClick={() => handleCopy(webhookUrl, 'url')}
              className="px-4 py-2.5 rounded-lg text-[12px] font-bold border border-gray-200 hover:bg-gray-50 flex items-center gap-1 text-gray-700 transition-colors"
            >
              {copiedField === 'url' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              {copiedField === 'url' ? 'Kopyalandı' : 'Kopyala'}
            </button>
          </div>
        </div>

        {/* Webhook Secret Field */}
        <div>
          <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
            Webhook Secret (Gizli Anahtar)
          </label>
          <div className="flex gap-2">
            <input
              readOnly
              value={rawSecret || webhookSecretMasked || 'wh_sec_konfigüre_edilmedi'}
              className={`flex-1 px-3 py-2.5 rounded-lg border text-[13px] font-mono outline-none ${
                rawSecret ? 'bg-emerald-50 border-emerald-300 text-emerald-800 font-bold' : 'bg-gray-50 text-gray-600'
              }`}
              style={rawSecret ? {} : { borderColor: 'var(--q-border-default)' }}
            />
            <button
              disabled={!rawSecret}
              onClick={() => handleCopy(rawSecret, 'secret')}
              className="px-4 py-2.5 rounded-lg text-[12px] font-bold border border-gray-200 hover:bg-gray-50 flex items-center gap-1 text-gray-700 transition-colors disabled:opacity-50"
            >
              {copiedField === 'secret' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              {copiedField === 'secret' ? 'Kopyalandı' : 'Kopyala'}
            </button>
          </div>
          {rawSecret && (
            <p className="text-[11px] text-emerald-600 font-bold mt-1">
              ✓ Yeni gizli anahtar başarıyla üretildi. Lütfen bunu şimdi kopyalayın! Bu değer sadece bir kez gösterilecektir.
            </p>
          )}
          {!rawSecret && webhookSecretMasked && (
            <p className="text-[11px] text-amber-600 font-medium mt-1.5 leading-relaxed">
              ⚠️ Güvenlik nedeniyle kayıtlı gizli anahtar tekrar görüntülenemez. Kopyalamak için aşağıdaki "Gizli Anahtarı Yenile" butonunu kullanın.
            </p>
          )}

          {/* Secret Status Badge */}
          {webhookSecretMasked ? (
            <div className="flex items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Özel Gizli Anahtar Aktif
              </span>
            </div>
          ) : (
            <div className="space-y-2 mt-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Genel Fallback Aktif (Güvensiz)
                </span>
              </div>
              <p className="text-[11px] text-amber-600 font-medium leading-relaxed">
                ℹ️ Güvenli ve izole bir veri akışı için lütfen "Gizli Anahtarı Yenile" butonunu kullanarak tenant-specific özel bir anahtar oluşturun.
              </p>
            </div>
          )}
        </div>

        {/* Rotate Button & Warnings */}
        <div className="pt-2">
          {!showRotateConfirm ? (
            <button
              onClick={() => setShowRotateConfirm(true)}
              className="px-3.5 py-2 rounded-lg text-[12px] font-bold border border-amber-200 hover:bg-amber-50 text-amber-700 transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Gizli Anahtarı Yenile
            </button>
          ) : (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
              <div className="flex gap-2.5 items-start">
                <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h5 className="text-[13px] font-bold text-amber-900">Güvenlik Uyarısı ve Risk Bildirimi</h5>
                  <p className="text-[12px] text-amber-700 leading-relaxed mt-1">
                    Bu işlem yeni bir webhook secret üretir. Google Sheets üzerindeki entegrasyonunuzda (Apps Script) <strong>WEBHOOK_SECRET</strong> parametresini güncellemezseniz, veri akışı kesilecektir.
                  </p>
                  <p className="text-[12px] text-amber-700 leading-relaxed mt-1">
                    Yeni üretilen anahtar güvenlik nedeniyle <strong>yalnızca bir kez</strong> gösterilecektir.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => setShowRotateConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-bold border border-gray-300 hover:bg-gray-100 text-gray-700 transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  disabled={rotating}
                  onClick={handleRotateSecret}
                  className="px-4 py-1.5 rounded-lg text-[12px] font-bold bg-amber-600 hover:bg-amber-700 text-white transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  {rotating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Yeni Anahtar Üret
                </button>
              </div>
            </div>
          )}
          {rotateError && (
            <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
              <p className="text-[12px] font-medium text-rose-700">{rotateError}</p>
            </div>
          )}
        </div>

        {/* Apps Script Copyable Code Block */}
        {rawSecret ? (
          <AppsScriptSnippet
            webhookUrl={webhookUrl}
            tenantSlug={tenantSlug}
            secret={rawSecret}
            sheetName={selectedTabs[0] || 'Sayfa1'}
          />
        ) : (
          <div className="mt-4 border-t pt-4 border-gray-100">
            <div className="p-4 bg-amber-50 border border-amber-200/60 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <h5 className="text-[13px] font-bold text-amber-900">Kurulum Kodunu Almak İçin Anahtar Üretin</h5>
                <p className="text-[12px] text-amber-700 leading-relaxed mt-1 font-medium">
                  Güvenlik gereği, kayıtlı gizli anahtarlar maskeli olarak saklanır ve kopyalanamaz. 
                  Apps Script entegrasyon kodunu kopyalamak için lütfen yukarıdaki 
                  <strong> "Gizli Anahtarı Yenile"</strong> butonunu kullanarak yeni bir anahtar oluşturun. 
                  Yeni anahtar üretildiğinde kurulum kodu otomatik olarak burada belirecektir.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ═══════════════════════════════════════════
  // STEP 2: Tab Selection
  // ═══════════════════════════════════════════
  const Step2Tabs = (
    <div className="space-y-4">
      <p className="text-[13px] font-medium" style={{ color: 'var(--q-text-secondary)' }}>
        Hangi sekmelerdeki yeni satırlar lead olarak işlensin?
      </p>
      
      {tabs.length > 0 ? (
        <div className="space-y-2">
          {tabs.map(tab => (
            <div
              key={tab.id}
              onClick={() => toggleTab(tab.title)}
              className={`flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all ${
                selectedTabs.includes(tab.title)
                  ? 'border-[#0F9D58] bg-emerald-50/40 shadow-sm'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mr-4 flex-shrink-0 ${
                selectedTabs.includes(tab.title) ? 'bg-emerald-100' : 'bg-gray-100'
              }`}>
                <Columns className={`w-5 h-5 ${selectedTabs.includes(tab.title) ? 'text-emerald-600' : 'text-gray-400'}`} />
              </div>
              <div className="flex-1">
                <h4 className="text-[15px] font-bold" style={{ color: 'var(--q-text-primary)' }}>{tab.title}</h4>
              </div>
              {selectedTabs.includes(tab.title) && (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <Columns className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-[13px] font-medium text-gray-500">
            Önce bir spreadsheet bağlayın
          </p>
        </div>
      )}
    </div>
  );

  // ═══════════════════════════════════════════
  // STEP 3: Routing Config
  // ═══════════════════════════════════════════
  const Step3Routing = (
    <div className="space-y-6">
      <div className="p-4 bg-purple-50/50 border border-purple-100 rounded-xl">
        <div className="flex items-start gap-3">
          <Settings2 className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="text-[14px] font-bold text-purple-900 mb-1">Yönlendirme Ayarları</h4>
            <p className="text-[12px] text-purple-700">
              Sheet'ten gelen lead'ler hangi WhatsApp kanalı üzerinden karşılanacak ve hangi bot yanıt verecek?
            </p>
          </div>
        </div>
      </div>
      
      {/* Outbound WhatsApp Channel */}
      <div>
        <label className="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <MessageCircle className="w-3.5 h-3.5" /> Outbound WhatsApp Kanalı
        </label>
        <select
          value={selectedChannelId}
          onChange={e => setSelectedChannelId(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border text-[14px] font-medium outline-none bg-white"
          style={{ borderColor: 'var(--q-border-default)' }}
        >
          {channels.length === 0 && (
            <option value="">Aktif WhatsApp kanalı yok</option>
          )}
          {channels.map(ch => (
            <option key={ch.id} value={ch.id}>{ch.name}</option>
          ))}
        </select>
        <p className="text-[11px] mt-1.5 font-medium" style={{ color: 'var(--q-text-secondary)' }}>
          Lead telefon numarasına bu kanal üzerinden mesaj gönderilecek.
        </p>
      </div>
      
      {/* Greeting Bot */}
      <div>
        <label className="text-[12px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5" /> Karşılama Botu
        </label>
        <select
          value={selectedBotId}
          onChange={e => setSelectedBotId(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border text-[14px] font-medium outline-none bg-white"
          style={{ borderColor: 'var(--q-border-default)' }}
        >
          {bots.map(b => (
            <option key={b.id} value={b.id}>{b.displayName}</option>
          ))}
        </select>
        <p className="text-[11px] mt-1.5 font-medium" style={{ color: 'var(--q-text-secondary)' }}>
          Otomatik karşılama mesajı bu botun promptu ile oluşturulacak.
        </p>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════
  // STEP 4: Save & Activate
  // ═══════════════════════════════════════════
  const Step4Save = (
    <div className="space-y-6">
      {saveSuccess ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-8">
          <div className="w-20 h-20 bg-emerald-50 border-[3px] border-emerald-200 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
          <h3 className="text-[20px] font-bold" style={{ color: 'var(--q-text-primary)' }}>
            Pipeline Aktif!
          </h3>
          <p className="text-[14px] mt-2 font-medium" style={{ color: 'var(--q-text-secondary)' }}>
            Google Sheets → Lead → WhatsApp akışı kaydedildi.
          </p>
          <div className="mt-6 space-y-2 max-w-sm mx-auto text-left">
            <div className="flex items-center gap-2 text-[12px] p-2 bg-gray-50 rounded-lg">
              <FileSpreadsheet className="w-4 h-4 text-[#0F9D58]" />
              <span className="font-medium">Sheet: {spreadsheetId.slice(0, 16)}...</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] p-2 bg-gray-50 rounded-lg">
              <Columns className="w-4 h-4 text-blue-500" />
              <span className="font-medium">Sekmeler: {selectedTabs.join(', ')}</span>
            </div>
            {channels.find(c => c.id === selectedChannelId) && (
              <div className="flex items-center gap-2 text-[12px] p-2 bg-gray-50 rounded-lg">
                <MessageCircle className="w-4 h-4 text-emerald-500" />
                <span className="font-medium">WhatsApp: {channels.find(c => c.id === selectedChannelId)?.name}</span>
              </div>
            )}
            {bots.find(b => b.id === selectedBotId) && (
              <div className="flex items-center gap-2 text-[12px] p-2 bg-gray-50 rounded-lg">
                <Bot className="w-4 h-4 text-purple-500" />
                <span className="font-medium">Bot: {bots.find(b => b.id === selectedBotId)?.displayName}</span>
              </div>
            )}
          </div>
        </motion.div>
      ) : (
        <>
          {/* Config Summary */}
          <div className="bg-white rounded-xl border p-5 space-y-3" style={{ borderColor: 'var(--q-border-default)' }}>
            <h4 className="text-[14px] font-bold" style={{ color: 'var(--q-text-primary)' }}>Yapılandırma Özeti</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium" style={{ color: 'var(--q-text-secondary)' }}>Spreadsheet</span>
                <span className="font-bold font-mono text-[12px]">{spreadsheetId.slice(0, 20)}...</span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium" style={{ color: 'var(--q-text-secondary)' }}>Aktif Sekmeler</span>
                <span className="font-bold">{selectedTabs.join(', ') || 'Seçilmedi'}</span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium" style={{ color: 'var(--q-text-secondary)' }}>WhatsApp Kanalı</span>
                <span className="font-bold">{channels.find(c => c.id === selectedChannelId)?.name || 'Seçilmedi'}</span>
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium" style={{ color: 'var(--q-text-secondary)' }}>Karşılama Botu</span>
                <span className="font-bold">{bots.find(b => b.id === selectedBotId)?.displayName || 'Seçilmedi'}</span>
              </div>
            </div>
          </div>
          
          {saveError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
              <p className="text-[12px] font-medium text-rose-700">{saveError}</p>
            </div>
          )}
          
          <button
            onClick={handleSave}
            disabled={saving || !spreadsheetId || selectedTabs.length === 0}
            className="w-full py-3 rounded-xl text-white text-[14px] font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-all hover:opacity-90"
            style={{ backgroundColor: '#0F9D58' }}
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Kaydediliyor...</>
            ) : (
              <><Save className="w-4 h-4" /> Kaydet &amp; Aktifleştir</>
            )}
          </button>
        </>
      )}
    </div>
  );

  // ═══════════════════════════════════════════
  // WIZARD STEPS
  // ═══════════════════════════════════════════
  const steps: WizardStep[] = [
    { 
      id: 'connect', 
      title: 'Bağlantı', 
      component: Step1Connect, 
      isValid: !!spreadsheetId && tabs.length > 0 
    },
    { 
      id: 'tabs', 
      title: 'Sekmeler', 
      component: Step2Tabs, 
      isValid: selectedTabs.length > 0 
    },
    { 
      id: 'routing', 
      title: 'Yönlendirme', 
      component: Step3Routing, 
      isValid: true 
    },
    { 
      id: 'save', 
      title: 'Kaydet', 
      component: Step4Save, 
      isValid: saveSuccess 
    },
  ];

  return (
    <IntegrationWizard 
      isOpen={isOpen} 
      onClose={onClose} 
      providerId="google_sheets" 
      providerName="Google Sheets Entegrasyonu" 
      providerIcon={<FileSpreadsheet className="w-8 h-8 text-[#0F9D58]" />} 
      steps={steps} 
      onComplete={handleFinish} 
      localStorageKey="draft_google_sheets_wizard_v4" 
    />
  );
}
