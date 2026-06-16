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
      showLanguageSuggestion: false
    };

    switch (decision.category) {
      case 'bot_auto_eligible':
        if (decision.finalActionAllowed) {
          presentation.badgeText = 'Otopilot Hazır';
          presentation.badgeColor = 'green';
          presentation.title = 'Otomatik Karşılama Aktif';
          presentation.description = 'Hasta WhatsApp üzerinden yazdı ve Meta 24 saat penceresi açık. Sistem otomatik cevap verebilir.';
          presentation.buttonText = 'İletişimi Gör';
          presentation.buttonAction = 'go_to_inbox';
        } else {
          // Blocked by gates
          presentation.badgeText = 'Kısıtlı / Dry-Run';
          presentation.badgeColor = 'yellow';
          presentation.title = 'Güvenlik Kilidi Aktif';
          presentation.description = decision.userFriendlyReason || 'Sistem canlı gönderim kilitleri nedeniyle dry-run veya test modundadır.';
          presentation.buttonText = 'Taslak Oluştur';
          presentation.buttonAction = 'prepare_draft';
        }
        break;

      case 'manual_draft_required':
        presentation.badgeText = 'Taslak Gerekli';
        presentation.badgeColor = 'orange';
        presentation.title = 'İlk Temas Başlatılmalı';
        presentation.description = decision.userFriendlyReason || 'Hasta henüz WhatsApp’tan yazmadı. Manuel bir taslak mesaj hazırlanması gerekir.';
        presentation.buttonText = 'Mesaj Taslağı Hazırla';
        presentation.buttonAction = 'prepare_draft';
        presentation.showLanguageSuggestion = !!decision.language;
        presentation.suggestedLanguageText = `Önerilen dil: ${defaultLang}`;
        presentation.languageConfidenceText = `Güven: ${confidence}`;
        break;

      case 'manual_template_required':
        presentation.badgeText = 'Şablon Gerekli';
        presentation.badgeColor = 'yellow';
        presentation.title = '24s Penceresi Kapalı';
        presentation.description = decision.userFriendlyReason || '24 saatlik müşteri penceresi kapandığı için serbest metin gönderilemez, onaylı şablon (template) seçilmelidir.';
        presentation.buttonText = 'Şablon Seç';
        presentation.buttonAction = 'select_template';
        presentation.showLanguageSuggestion = !!decision.language;
        presentation.suggestedLanguageText = `Önerilen dil: ${defaultLang}`;
        presentation.languageConfidenceText = `Güven: ${confidence}`;
        break;

      case 'already_open_inbox':
        presentation.badgeText = 'Temsilcide';
        presentation.badgeColor = 'blue';
        presentation.title = 'İnsan Temsilci Devraldı';
        presentation.description = 'Bu konuşma bir insan temsilci tarafından devralınmış durumda. Otomatik bot devre dışıdır.';
        presentation.buttonText = 'Konuşmaya Git';
        presentation.buttonAction = 'go_to_inbox';
        break;

      case 'already_processed':
        presentation.badgeText = 'İşlenmiş';
        presentation.badgeColor = 'gray';
        presentation.title = 'İlk Temas Yapılmış';
        presentation.description = 'Bu kayıt için ilk temas mesajı veya otopilot karşılama işlemi daha önce gerçekleştirilmiş.';
        presentation.buttonText = 'Konuşmayı Aç';
        presentation.buttonAction = 'go_to_inbox';
        break;

      case 'error':
      case 'not_eligible':
      default:
        presentation.badgeText = 'Bilinmiyor';
        presentation.badgeColor = 'red';
        presentation.title = 'Analiz Hatası';
        presentation.description = decision.userFriendlyReason || 'Lead bilgisi veya konuşma parametreleri eksik olduğu için durum belirlenemedi.';
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
