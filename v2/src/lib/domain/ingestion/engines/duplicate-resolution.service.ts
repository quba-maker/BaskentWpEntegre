import { AIProvider } from '../../ai/providers/ai-provider.interface';

export class DuplicateResolutionService {
  constructor(private aiProvider: AIProvider) {}

  /**
   * Evaluates if a new incoming lead is a duplicate of an existing lead in the CRM.
   * Utilizes phonetic similarity, fuzzy matching, and semantic distance.
   */
  async detectDuplicates(newLead: Record<string, string>, existingLeads: Record<string, string>[]) {
    const matches = [];

    for (const lead of existingLeads) {
      // Fast exact match check
      if (newLead.phone === lead.phone && newLead.phone) {
        matches.push({ leadId: lead.id, score: 1.0, reason: 'exact_phone_match' });
        continue;
      }

      // Slower AI Semantic similarity check (e.g. for Names "Ahmet Yılmaz" vs "Ahmet Yilmaz")
      if (newLead.name && lead.name) {
        const nameSimilarity = await this.aiProvider.semanticMatch(newLead.name, lead.name);
        if (nameSimilarity > 0.90) {
          matches.push({ leadId: lead.id, score: nameSimilarity, reason: 'fuzzy_name_match' });
        }
      }
    }

    return matches;
  }
}
