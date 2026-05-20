export class SafetyGuardrailsService {
  /**
   * Analyzes the risk of a sync operation before execution.
   * Prevents mass overwrites of CRM data.
   */
  static analyzeSyncRisk(totalExistingRecords: number, recordsToModify: number): 'safe' | 'critical_approval_required' {
    if (totalExistingRecords === 0) return 'safe';

    const modifyPercentage = recordsToModify / totalExistingRecords;

    // If more than 70% of the CRM is being overwritten at once, block it.
    if (modifyPercentage > 0.70) {
      return 'critical_approval_required';
    }

    return 'safe';
  }
}
