export interface IntentResult {
  intent: string;
  confidence: number;
}

export interface ExtractedEntity {
  field: string;
  value: string;
  confidence: number;
}

export interface SchemaField {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'date';
}

/**
 * AI Provider Abstraction
 * Ensures the system is not tightly coupled to OpenAI, Gemini, or any specific LLM.
 */
export interface AIProvider {
  /**
   * Identifies the primary intent of a user message.
   */
  analyzeIntent(payload: string): Promise<IntentResult>;

  /**
   * Extracts structured entities from unstructured text based on a given schema.
   */
  extractEntities(payload: string, schema: SchemaField[]): Promise<ExtractedEntity[]>;

  /**
   * Calculates the semantic similarity between two strings (e.g. for Duplicate Detection).
   * Returns a score between 0 and 1.
   */
  semanticMatch(fieldA: string, fieldB: string): Promise<number>;

  /**
   * Generates an intelligent reply based on context.
   */
  generateReply(context: string, prompt: string): Promise<string>;
}
