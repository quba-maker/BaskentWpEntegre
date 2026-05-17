export class PiiSanitizer {
  public static sanitize(metadata?: Record<string, any>): Record<string, any> | undefined {
    if (!metadata) return undefined;
    
    const sanitized = { ...metadata };
    
    // PII Masking & Truncation
    for (const key of Object.keys(sanitized)) {
      if (typeof sanitized[key] === 'string' && sanitized[key].match(/(?:\+|00|0)?[1-9][0-9 \-\(\)\.]{9,15}/)) {
        sanitized[key] = "[MASKED_PHONE]";
      }
    }
    return sanitized;
  }
}
