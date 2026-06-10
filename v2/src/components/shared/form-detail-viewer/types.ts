export type UniversalFormDetailData = {
  id: string;
  tenantId?: string;
  channelId?: string;
  leadId?: string;
  conversationId?: string | null;
  opportunityId?: string | null;

  identity: {
    name?: string;
    phoneNumbers: string[];
    primaryPhone?: string;
    email?: string | null;
    country?: { name: string; flag?: string; isEstimated?: boolean } | null;
  };

  source: {
    platform?: string;
    campaignName?: string;
    formName?: string;
    submittedAt?: string;
  };

  content: {
    complaint?: string | null;
    appointmentPreference?: string | null;
    reportStatus?: string | null;
    department?: string | null;
    userAnswers: Array<{ key: string; label: string; value: string }>;
    techMetadata: Array<{ key: string; label: string; value: string }>;
  };

  ai?: {
    summary?: string | null;
  };
};
