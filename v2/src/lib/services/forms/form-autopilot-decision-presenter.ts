import { GreetingAutomationDecision } from "../automation/first-contact-decision-resolver";
import { ConversationBotControlDecision } from "../automation/conversation-bot-control-resolver";

export interface FormUiPresentation {
  badgeText: string;
  badgeColor: 'green' | 'orange' | 'yellow' | 'red' | 'gray' | 'blue';
  title: string;
  description: string;
  buttonText: string;
  buttonAction: 'go_to_inbox' | 'prepare_draft' | 'select_template' | 'none';
  showLanguageSuggestion: boolean;
  suggestedLanguageText?: string;
  languageConfidenceText?: string;
  gateStateText?: string;
  gateReasonsTexts?: string[];
}

export interface InboxUiPresentation {
  statusText: string;
  statusColor: 'green' | 'orange' | 'yellow' | 'red' | 'gray' | 'blue';
  allowBotToggle: boolean;
  toggleActionText: 'enable_bot' | 'disable_bot' | 'none';
  infoText: string;
}

const LANG_MAP: Record<string, string> = {
  tr: 'Türkçe',
  en: 'İngilizce',
  ru: 'Rusça',
  ar: 'Arapça',
  de: 'Almanca',
  fr: 'Fransızca',
  nl: 'Flemenkçe',
  unknown: 'Bilinmiyor'
};

const CONFIDENCE_MAP: Record<string, string> = {
  high: 'Yüksek',
  medium: 'Orta',
  low: 'Düşük'
};

const GATE_STATE_MAP: Record<string, string> = {
  open: 'Gönderim açık',
  live_locked: 'Canlı gönderim kapalı',
  dry_run: 'Test modu aktif',
  feature_disabled: 'Ayar Kapalı',
  allowlist_missing: 'Firma izni eksik',
  global_disabled: 'Genel gönderim kapalı'
};

const GATE_REASON_MAP: Record<string, string> = {
  phase_lock_enabled: 'Canlı gönderim bu ortamda kapalı',
  dry_run_enabled: 'Bu işlem sadece test ediliyor',
  feature_flag_disabled: 'Otomatik ilk temas ayarı kapalı',
  allowlist_missing: 'Bu firma için canlı izin tanımlı değil',
  global_disabled: 'Genel gönderim kilidi açık'
};

export class FormDecisionPresenter {
  public static present(decision: GreetingAutomationDecision): FormUiPresentation {
    const defaultLang = decision.language ? LANG_MAP[decision.language] : 'Türkçe';
    const confidence = decision.languageConfidence ? CONFIDENCE_MAP[decision.languageConfidence] : 'Düşük';

    const presentation: FormUiPresentation = {
      badgeText: 'Durum Belirsiz',
      badgeColor: 'gray',
      title: 'İlk Temas Analiz Ediliyor',
      description: decision.userFriendlyReason || 'İlk temas durumu şu anda hesaplanıyor.',
      buttonText: 'Detayları Gör',
      buttonAction: 'none',
      showLanguageSuggestion: false,
      gateStateText: GATE_STATE_MAP[decision.gateState] || 'Bilinmiyor',
      gateReasonsTexts: (decision.gateReasons || []).map(r => GATE_REASON_MAP[r] || r)
    };

    switch (decision.baseCategory) {
      case 'bot_auto_eligible':
        presentation.badgeText = 'Cevap Geldi';
        presentation.badgeColor = 'green';
        presentation.title = 'Inbox’tan Yanıtlanabilir';
        presentation.description = 'Hasta WhatsApp üzerinden yazmış. Konuşma penceresi açık olduğu için bu kişiyle inbox üzerinden devam edilebilir.';
        presentation.buttonText = 'Konuşmayı Aç';
        presentation.buttonAction = 'go_to_inbox';
        break;

      case 'manual_draft_required':
        presentation.badgeText = 'Karşılama Bekliyor';
        presentation.badgeColor = 'orange';
        presentation.title = 'İlk Mesaj Hazırlanabilir';
        presentation.description = decision.userFriendlyReason || 'Bu kişiyle henüz WhatsApp konuşması başlamamış. İlk temas için taslak hazırlanabilir.';
        presentation.buttonText = 'Taslak Hazırla';
        presentation.buttonAction = 'prepare_draft';
        presentation.showLanguageSuggestion = !!decision.language;
        presentation.suggestedLanguageText = `Önerilen dil: ${defaultLang}`;
        presentation.languageConfidenceText = `Güven: ${confidence}`;
        break;

      case 'manual_template_required':
        presentation.badgeText = 'Hazır Şablon';
        presentation.badgeColor = 'yellow';
        presentation.title = 'Onaylı Şablon Kullanılmalı';
        presentation.description = decision.userFriendlyReason || 'Serbest mesaj penceresi kapalı. İlk temas için onaylı WhatsApp şablonu kullanılmalı.';
        presentation.buttonText = 'Hazır Şablon Seç';
        presentation.buttonAction = 'select_template';
        presentation.showLanguageSuggestion = !!decision.language;
        presentation.suggestedLanguageText = `Önerilen dil: ${defaultLang}`;
        presentation.languageConfidenceText = `Güven: ${confidence}`;
        break;

      case 'already_open_inbox':
        presentation.badgeText = 'Cevap Bekleniyor';
        presentation.badgeColor = 'blue';
        presentation.title = 'İletişim Başlamış';
        presentation.description = 'Bu kişiyle daha önce iletişim kurulmuş. Devam gerekiyorsa konuşmayı açabilirsiniz.';
        presentation.buttonText = 'Konuşmayı Aç';
        presentation.buttonAction = 'go_to_inbox';
        break;

      case 'error':
      case 'not_eligible':
      default:
        presentation.badgeText = 'Uygun Değil';
        presentation.badgeColor = 'red';
        presentation.title = 'Kontrol Gerekli';
        presentation.description = decision.userFriendlyReason || 'Telefon, form veya konuşma bilgisi eksik görünüyor. Gönderimden önce kontrol edilmeli.';
        presentation.buttonText = 'Detayları İncele';
        presentation.buttonAction = 'none';
        break;
    }

    return presentation;
  }
}

export class InboxBotControlPresenter {
  public static present(decision: ConversationBotControlDecision): InboxUiPresentation {
    const presentation: InboxUiPresentation = {
      statusText: 'Durum Bilinmiyor',
      statusColor: 'gray',
      allowBotToggle: false,
      toggleActionText: 'none',
      infoText: 'Konuşma durumu hesaplanamadı.'
    };

    switch (decision.category) {
      case 'human_taken_over':
        presentation.statusText = 'İnsan Temsilci';
        presentation.statusColor = 'blue';
        presentation.allowBotToggle = false;
        presentation.toggleActionText = 'none';
        presentation.infoText = 'İnsan temsilci devraldı. Bot bu konuşma için devre dışı bırakılmıştır.';
        break;

      case 'bot_enabled':
        presentation.statusText = 'Bot Aktif';
        presentation.statusColor = 'green';
        presentation.allowBotToggle = true;
        presentation.toggleActionText = 'disable_bot';
        presentation.infoText = 'Bot açıldı: Sonraki uygun hasta mesajlarında otomatik cevap verebilir.';
        break;

      case 'bot_disabled':
        presentation.statusText = 'Bot Devre Dışı';
        presentation.statusColor = 'orange';
        presentation.allowBotToggle = true;
        presentation.toggleActionText = 'enable_bot';
        presentation.infoText = 'Bot kapatılmıştır. Mesajlara sadece manuel cevap verilir.';
        break;

      case 'meta_window_closed':
        presentation.statusText = 'Bot Kilitli (24s Kapalı)';
        presentation.statusColor = 'yellow';
        presentation.allowBotToggle = true;
        presentation.toggleActionText = decision.autopilotEnabled ? 'disable_bot' : 'enable_bot';
        presentation.infoText = '24 saat penceresi kapalı. Bot açık olsa dahi sadece yeni inbound geldiğinde cevap yazabilir.';
        break;

      case 'not_eligible':
      default:
        presentation.statusText = 'Bot Uyumsuz';
        presentation.statusColor = 'red';
        presentation.allowBotToggle = false;
        presentation.toggleActionText = 'none';
        presentation.infoText = decision.userFriendlyReason || 'Kanal WhatsApp olmadığı veya konuşma bulunamadığı için bot devre dışı.';
        break;
    }

    return presentation;
  }
}
