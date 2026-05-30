/**
 * PHASE 2K-P1: Telegram Notification Service
 * 
 * Sends formatted notifications to Telegram groups via Bot API.
 * 
 * Security:
 * - Bot token is encrypted at rest (encryptPayload/decryptPayload)
 * - Phone numbers are NEVER shown in full (masked: +90 *** ** 33 06)
 * - Messages NEVER contain `Tel:` pattern (V1 reply parser protection)
 * - All API calls are non-fatal — panel notification always survives
 * - Timeout: 5s per request
 */

import { logger } from '@/lib/core/logger';
import { encryptPayload, decryptPayload, EncryptedPayload } from '@/lib/core/encryption';
import type { NotificationInput, NotificationCategory, NotificationPriority } from './notification.service';
import { formatHumanDate, cleanString } from './sanitizers';

const log = logger.withContext({ module: 'TelegramService' });

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface TelegramChannelConfig {
  botToken: string;
  chatId: string;
}

export interface TelegramResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

interface TelegramChannelRow {
  id: string;
  tenant_id: string;
  channel_type: string;
  is_enabled: boolean;
  config: Record<string, any>;
  enabled_categories: string[];
  min_priority: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_tz: string;
}

// ═══════════════════════════════════════════════════════════
// PRIORITY ORDERING
// ═══════════════════════════════════════════════════════════

const PRIORITY_LEVELS: Record<string, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
  critical: 3,
};

function priorityMeetsMinimum(msgPriority: string, minPriority: string): boolean {
  const msgLevel = PRIORITY_LEVELS[msgPriority] ?? 1;
  const minLevel = PRIORITY_LEVELS[minPriority] ?? 1;
  return msgLevel >= minLevel;
}

// ═══════════════════════════════════════════════════════════
// CATEGORY EMOJI MAP
// ═══════════════════════════════════════════════════════════

const CATEGORY_HEADER: Record<string, { emoji: string; title: string }> = {
  hot_lead:               { emoji: '🔥', title: 'YENİ SICAK FIRSAT' },
  appointment_request:    { emoji: '📅', title: 'RANDEVU TALEBİ' },
  callback_requested:     { emoji: '📞', title: 'HASTA ARANMAK İSTİYOR' },
  report_received:        { emoji: '📄', title: 'RAPOR/BELGE ALINDI' },
  appointment_approaching:{ emoji: '⏰', title: 'RANDEVU YAKLAŞIYOR' },
  overdue_task:           { emoji: '🔴', title: 'GECİKEN GÖREV' },
  no_response:            { emoji: '⏳', title: 'HASTA CEVAP VERMİYOR' },
  bot_error:              { emoji: '🤖', title: 'BOT HATASI' },
  coordinator_action:     { emoji: '👤', title: 'KOORDİNATÖR AKSİYONU GEREKLİ' },
  human_escalation:       { emoji: '🚨', title: 'İNSAN MÜDAHALESİ GEREKLİ' },
  bot_delegation_ready:   { emoji: '🤖', title: 'BOT TAKİP TASLAĞI HAZIR' },
  system_alert:           { emoji: '⚙️', title: 'SİSTEM UYARISI' },
};

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

export class TelegramService {

  /**
   * Encrypts a bot token for secure DB storage.
   */
  static encryptBotToken(botToken: string): EncryptedPayload {
    return encryptPayload('telegram', { bot_token: botToken });
  }

  /**
   * Decrypts a bot token from DB storage.
   */
  static decryptBotToken(encrypted: EncryptedPayload): string {
    const decrypted = decryptPayload(encrypted);
    return decrypted.bot_token || '';
  }

  /**
   * Resolves Telegram config from a notification_channels row.
   * Decrypts botToken from encrypted envelope if present.
   * Falls back to env vars if DB config is empty.
   */
  static resolveConfig(channelRow?: TelegramChannelRow | null): TelegramChannelConfig | null {
    if (channelRow?.config) {
      const cfg = channelRow.config;

      // Encrypted bot token envelope
      let botToken = '';
      if (cfg.botTokenEncrypted && typeof cfg.botTokenEncrypted === 'object') {
        try {
          botToken = TelegramService.decryptBotToken(cfg.botTokenEncrypted as EncryptedPayload);
        } catch (e) {
          log.error('[TELEGRAM_DECRYPT_FAILED] Could not decrypt bot token', e instanceof Error ? e : new Error(String(e)));
          return null;
        }
      } else if (cfg.botToken && typeof cfg.botToken === 'string') {
        // Legacy plain text (should not happen after P1, but handle gracefully)
        botToken = cfg.botToken;
        log.warn('[TELEGRAM_PLAIN_TOKEN] Bot token stored in plaintext — should be re-encrypted');
      }

      const chatId = cfg.chatId || '';

      if (botToken && chatId) {
        return { botToken, chatId };
      }
    }

    // ENV fallback (single-tenant mode)
    const envToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const envChatId = process.env.TELEGRAM_CHAT_ID || '';
    if (envToken && envChatId) {
      return { botToken: envToken, chatId: envChatId };
    }

    return null;
  }

  /**
   * Checks if a notification should be dispatched to this channel.
   */
  static shouldDispatch(
    channelRow: TelegramChannelRow,
    category: NotificationCategory,
    priority: NotificationPriority
  ): boolean {
    if (!channelRow.is_enabled) return false;

    // Category filter: empty array = all categories allowed
    if (channelRow.enabled_categories && channelRow.enabled_categories.length > 0) {
      if (!channelRow.enabled_categories.includes(category)) {
        return false;
      }
    }

    // Priority filter
    const minPriority = channelRow.min_priority || 'normal';
    if (!priorityMeetsMinimum(priority, minPriority)) {
      return false;
    }

    return true;
  }

  /**
   * Sends a formatted notification to Telegram.
   * NEVER throws — always returns a result object.
   */
  static async sendNotification(
    config: TelegramChannelConfig,
    notification: NotificationInput
  ): Promise<TelegramResult> {
    try {
      const text = TelegramService.formatMessage(notification);
      return await TelegramService._sendMessage(config.botToken, config.chatId, text);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      log.error('[TELEGRAM_SEND_FAILED] Non-fatal dispatch error', e instanceof Error ? e : new Error(errorMsg), {
        tenantId: notification.tenantId,
        category: notification.category,
      });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Sends a test message to verify Telegram configuration.
   * Test messages contain NO real patient data.
   */
  static async sendTestMessage(config: TelegramChannelConfig): Promise<TelegramResult> {
    const now = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const text = [
      '✅ QUBA AI — Test Bildirimi',
      '━━━━━━━━━━━━━━',
      `⏰ Gönderim: ${now}`,
      '📌 Telegram bildirim kanalı başarıyla yapılandırıldı.',
      '',
      'Bu bir test mesajıdır. Gerçek hasta bilgisi içermez.',
    ].join('\n');

    return await TelegramService._sendMessage(config.botToken, config.chatId, text);
  }

  /**
   * Formats a notification into a Telegram-friendly message.
   * 
   * SECURITY RULES:
   * - NO `Tel:` pattern (prevents V1 reply parser from sending patient messages)
   * - Phone numbers are MASKED (+90 *** ** 33 06)
   * - No actionable data that could trigger unintended automation
   * - P1.1: Uses aggregated metadata.signals for secondary signal display
   * - P1.1: Human-readable dates (no raw ISO)
   */
  static formatMessage(notification: NotificationInput): string {
    const header = CATEGORY_HEADER[notification.category] || { emoji: '🔔', title: 'BİLDİRİM' };
    const meta = notification.metadata || {};

    const lines: string[] = [];

    // Header (category emoji + title)
    lines.push(`${header.emoji} ${header.title}`);
    lines.push('━━━━━━━━━━━━━━');

    // Body only (title is already represented by the header — no duplication)
    if (notification.body) {
      lines.push(notification.body);
    }

    // P1.1: Metadata enrichment from aggregated signals
    if (meta.patient_name && cleanString(meta.patient_name)) {
      lines.push(`👤 Hasta: ${cleanString(meta.patient_name)}`);
    } else if (meta.patientName && cleanString(meta.patientName)) {
      lines.push(`👤 Hasta: ${cleanString(meta.patientName)}`);
    }
    if (meta.country && cleanString(meta.country)) {
      lines.push(`🌍 Ülke: ${cleanString(meta.country)}`);
    }
    if (meta.department && cleanString(meta.department)) {
      lines.push(`🏥 Bölüm: ${cleanString(meta.department)}`);
    }

    // P1.1: Callback datetime in human format (not raw ISO)
    if (meta.callback_datetime && cleanString(meta.callback_datetime)) {
      lines.push(`🕒 Arama zamanı: ${formatHumanDate(meta.callback_datetime)}`);
    } else if (meta.patientLocalTime && meta.turkeyTime) {
      lines.push(`🕒 Hasta saati: ${meta.patientLocalTime}`);
      lines.push(`🕒 Türkiye saati: ${meta.turkeyTime}`);
    }

    // Masked phone (NEVER full phone, NEVER `Tel:` format)
    if (notification.phoneNumber) {
      lines.push(`📱 ${TelegramService.maskPhone(notification.phoneNumber)}`);
    }

    // P1.1: Signal summary
    const SIGNAL_EMOJI: Record<string, string> = {
      appointment_request: '📅 randevu talebi',
      callback_requested: '📞 arama talebi',
      hot_lead: '🔥 sıcak fırsat',
      report_sent: '📄 rapor gönderildi',
      report_waiting: '📄 rapor bekleniyor',
      requires_human: '👤 onay gerekiyor',
      human_escalation: '🚨 eskalasyon',
    };
    if (meta.signals && Array.isArray(meta.signals) && meta.signals.length > 1) {
      const signalLabels = meta.signals
        .map((s: string) => SIGNAL_EMOJI[s])
        .filter(Boolean);
      if (signalLabels.length > 0) {
        lines.push(`📋 Sinyaller: ${signalLabels.join(' | ')}`);
      }
    }

    // Priority badge
    const priorityBadge = notification.priority === 'critical' || notification.priority === 'high'
      ? '\n⚡ Yüksek Öncelik'
      : '';
    if (priorityBadge) lines.push(priorityBadge.trim());

    // Footer
    lines.push('');
    lines.push('📌 Detaylar için paneli açın.');

    return lines.join('\n');
  }

  /**
   * Masks a phone number for safe display.
   * +905321234506 → +90 *** ** 45 06
   * Ensures no `Tel:` pattern is used.
   */
  static maskPhone(phone: string): string {
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 6) return '***';

    // Show country code prefix + last 4 digits
    let prefix = '';
    let lastFour = cleaned.slice(-4);

    if (cleaned.startsWith('90') && cleaned.length >= 10) {
      prefix = '+90';
    } else if (cleaned.startsWith('49') && cleaned.length >= 10) {
      prefix = '+49';
    } else if (cleaned.startsWith('33') && cleaned.length >= 10) {
      prefix = '+33';
    } else if (cleaned.startsWith('44') && cleaned.length >= 10) {
      prefix = '+44';
    } else if (cleaned.startsWith('1') && cleaned.length >= 10) {
      prefix = '+1';
    } else {
      prefix = `+${cleaned.substring(0, 2)}`;
    }

    const last2a = lastFour.substring(0, 2);
    const last2b = lastFour.substring(2, 4);

    return `${prefix} *** ** ${last2a} ${last2b}`;
  }

  /**
   * Low-level Telegram Bot API sendMessage.
   * Has 5s timeout. Never throws on network errors.
   */
  private static async _sendMessage(
    botToken: string,
    chatId: string,
    text: string
  ): Promise<TelegramResult> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await res.json();

      if (!data.ok) {
        log.warn('[TELEGRAM_API_ERROR]', { status: res.status, description: data.description });
        return { success: false, error: data.description || `HTTP ${res.status}` };
      }

      return { success: true, messageId: data.result?.message_id };
    } catch (e) {
      const errorMsg = e instanceof Error
        ? (e.name === 'AbortError' ? 'Telegram API timeout (5s)' : e.message)
        : String(e);
      log.error('[TELEGRAM_NETWORK_ERROR]', e instanceof Error ? e : new Error(errorMsg));
      return { success: false, error: errorMsg };
    }
  }
}
