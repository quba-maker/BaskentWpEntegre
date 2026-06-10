"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  getFormDetailData 
} from "@/app/actions/forms";
import { 
  getOutreachHistory, 
  getGreetingTemplates, 
  resolveFirstContactAction, 
  prepareSmartGreetingDraftAction, 
  type OutreachLogEntry 
} from "@/app/actions/outreach";

export function useFormDetailState(selectedForm: any, onFormUpdate: () => void) {
  const [selectedPhone, setSelectedPhone] = useState("");
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [outreachTimeline, setOutreachTimeline] = useState<OutreachLogEntry[]>([]);
  const [outreachLoading, setOutreachLoading] = useState<'draft' | 'sending' | 'bot' | 'call_action' | null>(null);
  const [outreachError, setOutreachError] = useState<string | null>(null);
  const [outreachSuccess, setOutreachSuccess] = useState<string | null>(null);
  const [greetingSent, setGreetingSent] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [isDraftOpen, setIsDraftOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [callActionNote, setCallActionNote] = useState('');
  const [showCallActions, setShowCallActions] = useState(false);
  const [botNote, setBotNote] = useState('');
  const [readiness, setReadiness] = useState<any | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [techOpen, setTechOpen] = useState(false);

  const [draftSuccessTemp, setDraftSuccessTemp] = useState(false);

  const getAllPhones = (form: any): string[] => {
    const rd = form?.raw_data || {};
    let phones: string[] = [];
    try {
      if (rd._all_phones) {
        const parsed = typeof rd._all_phones === 'string' ? JSON.parse(rd._all_phones) : rd._all_phones;
        if (Array.isArray(parsed) && parsed.length > 0) phones = parsed;
      }
    } catch (_) {}
    if (phones.length === 0 && form?.phone_number) phones = [form.phone_number];
    return Array.from(new Set(phones));
  };

  const loadOutreachTimeline = useCallback(async (leadId: string) => {
    try {
      const history = await getOutreachHistory(leadId);
      setOutreachTimeline(history);
      const hasGreeting = history.some((h: OutreachLogEntry) => h.action === 'greeting_sent');
      setGreetingSent(hasGreeting);
    } catch (_) {
      setOutreachTimeline([]);
    }
  }, []);

  // Fetch detail information on demand / lazy loading
  const loadDetailLazy = useCallback(async (leadId: number) => {
    setDetailLoading(true);
    try {
      const detail = await getFormDetailData(leadId);
      setDetailData(detail);
    } catch (err: any) {
      console.error("Failed to load lazy form details:", err?.message);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadTemplatesLazy = useCallback(async () => {
    try {
      const t = await getGreetingTemplates();
      setTemplates(t);
    } catch (_) {
      setTemplates([]);
    }
  }, []);

  const loadReadinessLazy = useCallback(async (leadId: string, form: any) => {
    setReadinessLoading(true);
    try {
      const res = await resolveFirstContactAction(leadId);
      if (res && res.success && res.resolution) {
        setReadiness(res.resolution);
        
        const anySent = res.resolution.phones.some((p: any) => 
           p.hasManualGreetingConfirmed || p.hasInboxGreetingSent || p.hasApiGreetingSent
        );
        if (anySent) {
          setGreetingSent(true);
        }

        if (res.resolution.recommendedPhone?.phone) {
          setSelectedPhone(res.resolution.recommendedPhone.phone);
        }
      }
    } catch (_) {
      setReadiness(null);
    } finally {
      setReadinessLoading(false);
    }
  }, []);

  // Trigger lazy fetches whenselectedForm changes
  useEffect(() => {
    if (selectedForm?.id) {
      // Clear previous details
      setDetailData(null);
      setOutreachTimeline([]);
      setGreetingSent(false);
      setOutreachError(null);
      setOutreachSuccess(null);
      setDraftMessage(null);
      setIsDraftOpen(false);
      setCallActionNote('');
      setShowCallActions(false);
      setBotNote('');
      setSelectedTemplateId(null);
      setTechOpen(false);
      setReadiness(null);
      setDraftSuccessTemp(false);

      const phones = getAllPhones(selectedForm);
      setSelectedPhone(phones[0] || selectedForm.phone_number || "");

      // Trigger lazy loads
      loadDetailLazy(Number(selectedForm.id));
      loadOutreachTimeline(selectedForm.id);
      loadTemplatesLazy();
      loadReadinessLazy(selectedForm.id, selectedForm);
    }
  }, [selectedForm?.id, loadOutreachTimeline, loadDetailLazy, loadTemplatesLazy, loadReadinessLazy]);

  // Handle prepare draft (SMART greeting, manual only, no auto trigger)
  const handlePrepareDraft = async (form: any) => {
    setOutreachLoading('draft');
    setOutreachError(null);
    setOutreachSuccess(null);
    setDraftSuccessTemp(false);
    try {
      const result: any = await prepareSmartGreetingDraftAction(form.id);
      if (result.success && result.data?.draftText) {
        setDraftMessage(result.data.draftText);
        setDraftSuccessTemp(true);
        setTimeout(() => {
          setDraftSuccessTemp(false);
          setIsDraftOpen(true);
        }, 1500);
      } else {
        setOutreachError(result.error || 'Taslak hazırlanamadı.');
      }
    } catch (err: any) {
      setOutreachError(err?.message || 'Beklenmeyen bir hata oluştu.');
    } finally {
      setOutreachLoading(null);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const tpl = templates.find(t => t.id === templateId);
    if (tpl) {
      let body = tpl.body;
      if (selectedForm) {
        const rd = selectedForm.raw_data || {};
        const name = selectedForm.current_display_name || selectedForm.patient_name || rd.full_name || rd['full name'] || "Hasta";
        body = body.replace(/\{\{patient_name\}\}/g, name);
        body = body.replace(/\{\{name\}\}/g, name);
      }
      setDraftMessage(body);
    }
  };

  const handleCancelDraft = () => {
    setIsDraftOpen(false);
    setDraftMessage(null);
    setOutreachError(null);
    setSelectedTemplateId(null);
  };

  return {
    selectedPhone,
    setSelectedPhone,
    detailData,
    detailLoading,
    outreachTimeline,
    outreachLoading,
    setOutreachLoading,
    outreachError,
    setOutreachError,
    outreachSuccess,
    setOutreachSuccess,
    greetingSent,
    setGreetingSent,
    draftMessage,
    setDraftMessage,
    isDraftOpen,
    setIsDraftOpen,
    templates,
    selectedTemplateId,
    setSelectedTemplateId,
    callActionNote,
    setCallActionNote,
    showCallActions,
    setShowCallActions,
    botNote,
    setBotNote,
    readiness,
    readinessLoading,
    techOpen,
    setTechOpen,
    draftSuccessTemp,
    getAllPhones,
    loadOutreachTimeline,
    handlePrepareDraft,
    handleTemplateSelect,
    handleCancelDraft
  };
}
