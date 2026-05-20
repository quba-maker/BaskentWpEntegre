export type TransformationRule = 'trim' | 'proper_case' | 'phone_normalization' | 'infer_country';

export class TransformationService {
  /**
   * Applies rule-based formatting and transformation middleware to extracted entities.
   */
  static applyRules(value: string, rules: TransformationRule[]): string {
    let result = value;

    for (const rule of rules) {
      switch (rule) {
        case 'trim':
          result = result.trim();
          break;
        case 'proper_case':
          result = result.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
          break;
        case 'phone_normalization':
          // Strip everything except numbers and '+'
          result = result.replace(/[^\d+]/g, '');
          if (!result.startsWith('+') && result.length === 10) {
            result = '+90' + result; // Basic inference, should be dynamic in reality
          }
          break;
        case 'infer_country':
          if (result.startsWith('+90')) result = 'Turkey';
          break;
      }
    }

    return result;
  }
}
