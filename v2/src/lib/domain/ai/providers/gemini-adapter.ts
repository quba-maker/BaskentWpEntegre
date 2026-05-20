import { AIProvider, IntentResult, ExtractedEntity, SchemaField } from './ai-provider.interface';

/**
 * Gemini Adapter
 * Concrete implementation of the AIProvider interface using Google Gemini.
 */
export class GeminiAdapter implements AIProvider {
  async analyzeIntent(payload: string): Promise<IntentResult> {
    // Mocking Gemini SDK call
    return {
      intent: 'appointment_request',
      confidence: 0.95
    };
  }

  async extractEntities(payload: string, schema: SchemaField[]): Promise<ExtractedEntity[]> {
    // Mocking Gemini SDK call
    return [
      { field: 'phone', value: '+905321234567', confidence: 0.99 },
      { field: 'department', value: 'Cardiology', confidence: 0.88 }
    ];
  }

  async semanticMatch(fieldA: string, fieldB: string): Promise<number> {
    // Normally uses embeddings to calculate cosine similarity
    if (fieldA.toLowerCase() === fieldB.toLowerCase()) return 1.0;
    return 0.8; // Fallback similarity
  }

  async generateReply(context: string, prompt: string): Promise<string> {
    return 'Merhaba, randevu talebiniz alınmıştır.';
  }
}
