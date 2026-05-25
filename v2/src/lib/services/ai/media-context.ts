/**
 * Media Context Helper — Shared utility for AI history injection
 * 
 * Used by:
 * - ConversationService.getHistory() → AI chat history
 * - MemoryEngine → CRM summary generation
 * 
 * Rules:
 * - media_url is NEVER sent to AI (private Vercel Blob URL)
 * - Only safe metadata: media_type, caption, filename, mime_type
 * - Direction-aware labels (Müşteri vs Asistan)
 * - No content duplication (caption extracted cleanly)
 */

const MEDIA_EMOJI_PREFIXES = ['📷', '📎', '🎵', '🎬', '📍', '🏷️', '📦'];

interface MediaContextParams {
  direction: 'in' | 'out';
  mediaType: string;
  content: string;
  metadata?: {
    caption?: string;
    filename?: string;
    mime_type?: string;
    latitude?: number;
    longitude?: number;
    name?: string;
    [key: string]: any;
  };
}

/**
 * Builds AI-safe media context string for chat history injection.
 * 
 * Example outputs:
 * - [MÜŞTERİ FOTOĞRAF GÖNDERDİ — Fotoğraf başarıyla sisteme alındı. İçerik analizi yapılmadı. Caption: "ameliyat izi"]
 * - [MÜŞTERİ BELGE/RAPOR GÖNDERDİ — Dosya başarıyla sisteme alındı. Dosya adı: "tahlil.pdf". İçerik analizi yapılmadı.]
 * - [MÜŞTERİ SES MESAJI GÖNDERDİ — Ses kaydı başarıyla alındı. Transkripsiyon yapılmadı.]
 */
export function buildMediaContext(params: MediaContextParams): string {
  const { direction, mediaType, content, metadata } = params;
  const sender = direction === 'in' ? 'MÜŞTERİ' : 'ASİSTAN';
  
  const caption = extractCaption(content, metadata?.caption);
  const filename = metadata?.filename || '';

  switch (mediaType) {
    case 'image':
      return buildImageContext(sender, caption);
    case 'document':
      return buildDocumentContext(sender, filename, caption);
    case 'audio':
      return buildAudioContext(sender);
    case 'video':
      return buildVideoContext(sender, caption);
    case 'location':
      return buildLocationContext(sender, metadata);
    case 'sticker':
      return `[${sender} STICKER GÖNDERDİ — Sticker mesajı sisteme alındı.]`;
    default:
      return `[${sender} MEDYA GÖNDERDİ (${mediaType}) — Dosya sisteme alındı. İçerik analizi yapılmadı.]`;
  }
}

/**
 * Extracts clean caption without emoji prefix duplication.
 * 
 * Priority:
 * 1. metadata.caption (authoritative source)
 * 2. content after emoji prefix strip (e.g. "📷 Fotoğraf: ameliyat izi" → "ameliyat izi")
 * 3. null if content is just a placeholder
 */
function extractCaption(content: string, metadataCaption?: string): string | null {
  // Priority 1: metadata caption
  if (metadataCaption && metadataCaption.trim()) {
    return metadataCaption.trim();
  }
  
  // Priority 2: extract from content (strip emoji prefix)
  if (content) {
    const trimmed = content.trim();
    
    // Check if content is just a placeholder (no real text)
    const isPlaceholder = MEDIA_EMOJI_PREFIXES.some(prefix => {
      if (trimmed === prefix) return true;
      // Match "📷 Fotoğraf", "📎 Belge", etc. without caption
      const labelPattern = new RegExp(`^${escapeRegex(prefix)}\\s+\\S+$`);
      return labelPattern.test(trimmed);
    });
    if (isPlaceholder) return null;
    
    // Check for "📷 Fotoğraf: actual caption" pattern
    const colonIndex = trimmed.indexOf(': ');
    if (colonIndex !== -1) {
      const beforeColon = trimmed.substring(0, colonIndex);
      const hasEmojiPrefix = MEDIA_EMOJI_PREFIXES.some(p => beforeColon.startsWith(p));
      if (hasEmojiPrefix) {
        const extracted = trimmed.substring(colonIndex + 2).trim();
        return extracted || null;
      }
    }
    
    // Content has real text beyond placeholder
    const hasEmojiPrefix = MEDIA_EMOJI_PREFIXES.some(p => trimmed.startsWith(p));
    if (!hasEmojiPrefix) {
      return trimmed;
    }
  }
  
  return null;
}

function buildImageContext(sender: string, caption: string | null): string {
  let ctx = `[${sender} FOTOĞRAF GÖNDERDİ — Fotoğraf başarıyla sisteme alındı. İçerik analizi yapılmadı.`;
  if (caption) ctx += ` Caption: "${caption}"`;
  ctx += `]`;
  return ctx;
}

function buildDocumentContext(sender: string, filename: string, caption: string | null): string {
  let ctx = `[${sender} BELGE/RAPOR GÖNDERDİ — Dosya başarıyla sisteme alındı.`;
  if (filename) ctx += ` Dosya adı: "${filename}".`;
  ctx += ` İçerik analizi yapılmadı.`;
  if (caption) ctx += ` Not: "${caption}"`;
  ctx += `]`;
  return ctx;
}

function buildAudioContext(sender: string): string {
  return `[${sender} SES MESAJI GÖNDERDİ — Ses kaydı başarıyla alındı. Transkripsiyon yapılmadı.]`;
}

function buildVideoContext(sender: string, caption: string | null): string {
  let ctx = `[${sender} VİDEO GÖNDERDİ — Video başarıyla alındı. İçerik analizi yapılmadı.`;
  if (caption) ctx += ` Caption: "${caption}"`;
  ctx += `]`;
  return ctx;
}

function buildLocationContext(sender: string, metadata?: any): string {
  const name = metadata?.name || '';
  const lat = metadata?.latitude;
  const lng = metadata?.longitude;
  let ctx = `[${sender} KONUM GÖNDERDİ — Konum mesajı sisteme alındı.`;
  if (name) ctx += ` Konum: "${name}".`;
  else if (lat && lng) ctx += ` Koordinatlar: ${lat}, ${lng}.`;
  ctx += `]`;
  return ctx;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if a message content string is a media placeholder
 * (used by UI to decide whether to show text content alongside media render)
 */
export function isMediaPlaceholder(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  
  // Exact match: "📷 Fotoğraf", "📎 Belge", etc.
  const placeholders = [
    '📷 Fotoğraf', '📎 Belge', '🎵 Ses kaydı', 
    '🎬 Video', '📍 Konum', '🏷️ Sticker'
  ];
  if (placeholders.includes(trimmed)) return true;
  
  // Single emoji match
  if (MEDIA_EMOJI_PREFIXES.includes(trimmed)) return true;
  
  return false;
}

/**
 * Extracts display-ready caption from message text.
 * Strips emoji prefix if present.
 * Returns null if text is just a placeholder.
 */
export function extractDisplayCaption(text: string, mediaType?: string): string | null {
  if (!text || !mediaType) return null;
  if (isMediaPlaceholder(text)) return null;
  
  // Strip "📷 Fotoğraf: " prefix to get clean caption
  const colonIndex = text.indexOf(': ');
  if (colonIndex !== -1) {
    const beforeColon = text.substring(0, colonIndex);
    const hasEmojiPrefix = MEDIA_EMOJI_PREFIXES.some(p => beforeColon.startsWith(p));
    if (hasEmojiPrefix) {
      return text.substring(colonIndex + 2).trim() || null;
    }
  }
  
  return text;
}
