export interface DepartmentResolutionResult {
  suggestedDept: string | null;
  source: 'manual' | 'existing' | 'patient_message' | 'form_complaint' | 'ai_extraction' | 'form_campaign' | 'none';
  confidence: 'high' | 'medium' | 'low';
  hasConflict: boolean;
  conflictReason: string | null;
  writeAllowed: boolean;
}

export function resolveDepartmentWithConflict({
  existingDept,
  formCampaignDept,
  formCampaignSource,
  formCampaignConfidence = 0.0,
  formComplaintDept,
  formComplaintConfidence = 0.0,
  patientMsgDept,
  patientMsgConfidence = 'low',
  aiExtractedDept,
  isLocked = false
}: {
  existingDept: string | null;
  formCampaignDept: string | null;
  formCampaignSource?: string | null;
  formCampaignConfidence?: number;
  formComplaintDept: string | null;
  formComplaintConfidence?: number;
  patientMsgDept: string | null;
  patientMsgConfidence?: 'high' | 'medium' | 'low';
  aiExtractedDept?: string | null;
  isLocked?: boolean;
}): DepartmentResolutionResult {
  
  // 1. Manual / locked / existing department priority
  if (isLocked || existingDept) {
    return {
      suggestedDept: existingDept,
      source: isLocked ? 'manual' : 'existing',
      confidence: 'high',
      hasConflict: false,
      conflictReason: null,
      writeAllowed: false
    };
  }

  // Define extraction sources with their values, priorities and confidences
  const candidateList: {
    dept: string;
    source: DepartmentResolutionResult['source'];
    priority: number; // lower is higher priority
    confidence: DepartmentResolutionResult['confidence'];
  }[] = [];

  // Priority 1: Form raw_data complaint field keyword, high confidence
  if (formComplaintDept && formComplaintConfidence >= 0.8) {
    candidateList.push({
      dept: formComplaintDept,
      source: 'form_complaint',
      priority: 1,
      confidence: 'high'
    });
  }

  // Priority 2: Latest explicit patient statement, high confidence
  if (patientMsgDept && patientMsgConfidence === 'high') {
    candidateList.push({
      dept: patientMsgDept,
      source: 'patient_message',
      priority: 2,
      confidence: 'high'
    });
  }

  // Priority 3: AI structured extractor high confidence
  if (aiExtractedDept) {
    candidateList.push({
      dept: aiExtractedDept,
      source: 'ai_extraction',
      priority: 3,
      confidence: 'high'
    });
  }

  // Priority 4: Campaign name / form_name deterministic source
  if (formCampaignDept && formCampaignConfidence >= 0.8) {
    candidateList.push({
      dept: formCampaignDept,
      source: 'form_campaign',
      priority: 4,
      confidence: 'high'
    });
  }

  // Priority 5: Medium confidence patient message or form complaint candidates (UI candidate only)
  if (patientMsgDept && patientMsgConfidence === 'medium') {
    candidateList.push({
      dept: patientMsgDept,
      source: 'patient_message',
      priority: 5,
      confidence: 'medium'
    });
  }
  if (formComplaintDept && formComplaintConfidence === 0.5) {
    candidateList.push({
      dept: formComplaintDept,
      source: 'form_complaint',
      priority: 5,
      confidence: 'medium'
    });
  }

  if (candidateList.length === 0) {
    return {
      suggestedDept: null,
      source: 'none',
      confidence: 'low',
      hasConflict: false,
      conflictReason: null,
      writeAllowed: false
    };
  }

  // Sort by priority (ascending)
  candidateList.sort((a, b) => a.priority - b.priority);

  // Highest priority candidate wins
  const winner = candidateList[0];

  // Conflict Detection:
  // Disagreement occurs if two high confidence sources have different department values.
  let hasConflict = false;
  let conflictReason: string | null = null;

  // Specifically check for campaign/form name vs patient statement or complaint mismatch
  const primaryHighCampaign = formCampaignDept && formCampaignConfidence >= 0.8 ? formCampaignDept : null;
  const primaryHighMessage = (patientMsgDept && patientMsgConfidence === 'high') ? patientMsgDept : null;

  if (primaryHighCampaign && winner.dept && primaryHighCampaign.toLowerCase() !== winner.dept.toLowerCase()) {
    hasConflict = true;
    
    // Format warning message
    if (winner.source === 'patient_message') {
      conflictReason = `Form kampanyası ${formCampaignDept} görünüyor, ancak hasta son mesajında ${winner.dept} kontrolü istedi.`;
    } else {
      conflictReason = `Form kampanyası ${formCampaignDept} ile form şikayet detayındaki ${winner.dept} çelişiyor.`;
    }
  }

  // Write gate check
  // DB Auto-Write is only allowed if confidence is high, and there is NO conflict
  const writeAllowed = winner.confidence === 'high' && !hasConflict;

  return {
    suggestedDept: winner.dept,
    source: winner.source,
    confidence: winner.confidence,
    hasConflict,
    conflictReason,
    writeAllowed
  };
}
