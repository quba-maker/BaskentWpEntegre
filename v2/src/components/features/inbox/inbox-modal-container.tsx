"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useInboxStore } from "@/store/inbox-store";
import { getCrmPanelBundleAction, getMessages } from "@/app/actions/inbox";
import { PhoneCallModal } from "./phone-call-modal";
import { AppointmentModal } from "./appointment-modal";
import { FollowUpReminderModal } from "./follow-up-reminder-modal";
import { PatientFormModal } from "./patient-form-modal";
import { BotHandoffModal } from "./bot-handoff-modal";
import { DraftPreviewModal } from "./draft-preview-modal";
import { useParams } from "next/navigation";
import { Loader2, AlertCircle, X } from "lucide-react";
import { createPortal } from "react-dom";
import { resolveSchedulingPrefill } from "@/lib/utils/scheduling-context-resolver";

export function InboxModalContainer() {
  const activeModal = useInboxStore((state) => state.activeModal);
  const setActiveModal = useInboxStore((state) => state.setActiveModal);
  const activePhone = useInboxStore((state) => state.activePhone);
  const params = useParams();
  const tenantSlug = typeof params?.tenant_slug === "string" ? params.tenant_slug : "";
  const queryClient = useQueryClient();

  // Automatically close modal when active patient changes
  useEffect(() => {
    setActiveModal(null);
  }, [activePhone, setActiveModal]);

  const conversationId = activeModal?.conversationId;
  const modalType = activeModal?.modalType;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId || "");

  // Retrieve from infinite query cache first
  const cachedData = queryClient.getQueryData<any>(["messages", conversationId]);
  let cachedMessages: any[] = [];
  if (cachedData && "pages" in cachedData) {
    cachedMessages = cachedData.pages.flat();
  } else if (Array.isArray(cachedData)) {
    cachedMessages = cachedData;
  }

  // Messages query - utilize distinct key to avoid cache structure collisions
  const { data: messages = [] } = useQuery({
    queryKey: ["messages", conversationId, "prefill"],
    queryFn: async () => {
      if (cachedMessages.length > 0) return cachedMessages;
      if (!conversationId || !isUuid) return [];
      const res = await getMessages(conversationId, null, 20);
      return res;
    },
    initialData: cachedMessages.length > 0 ? cachedMessages : undefined,
    enabled: !!conversationId && isUuid && !!modalType,
    staleTime: 1000 * 60 * 5,
  });

  // CRM panel data query (cached)
  const { data: crmData, isLoading } = useQuery({
    queryKey: ["crm-panel", conversationId],
    queryFn: async () => {
      if (!conversationId || !isUuid) return null;
      const res = await getCrmPanelBundleAction(conversationId);
      return res.success ? res : null;
    },
    enabled: !!conversationId && isUuid && modalType !== "bot_handoff",
  });


  if (!activeModal || !conversationId) return null;

  const handleClose = () => {
    setActiveModal(null);
  };

  if (!tenantSlug) {
    return createPortal(
      <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999]" onClick={handleClose}>
        <div 
          className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-sm overflow-hidden flex flex-col mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-5 flex justify-between items-center bg-slate-50/50 border-b border-black/[0.05]">
            <div className="flex items-center gap-2 text-rose-600">
              <AlertCircle className="w-5 h-5" />
              <h3 className="text-sm font-extrabold text-[#1D1D1F]">Tenant Bulunamadı</h3>
            </div>
            <button onClick={handleClose} className="w-8 h-8 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8ED] flex items-center justify-center text-gray-500 hover:text-black transition-all cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-6 space-y-4 text-center">
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed font-medium">
              Geçerli bir tenant oturumu bulunamadı. Lütfen sayfayı yenileyin veya tekrar giriş yapın.
            </p>
            <button onClick={handleClose} className="w-full py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white text-[12px] font-bold rounded-xl transition-all cursor-pointer">
              Kapat
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  const crm = crmData as any;
  const patientName = activeModal.patientName || crm?.patientName || "Hasta";
  const phoneNumber = crm?.phoneNumber || activeModal.payload?.phoneNumber || conversationId;
  const oppId = crm?.opportunity?.id || null;

  // Render a loading modal spinner
  if (isLoading && modalType !== "bot_handoff") {
    return createPortal(
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-[9999]">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 shadow-xl flex items-center gap-3 border" style={{ borderColor: "var(--q-border-default)" }}>
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Hasta detayları yükleniyor...</span>
        </div>
      </div>,
      document.body
    );
  }

  // Opportunity Warning Overlay Helper
  const renderOpportunityWarning = (actionName: string) => {
    return createPortal(
      <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999] animate-in fade-in duration-200" onClick={handleClose}>
        <div 
          className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-sm overflow-hidden flex flex-col mx-4 animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-5 flex justify-between items-center bg-slate-50/50 border-b border-black/[0.05]">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="w-5 h-5" />
              <h3 className="text-sm font-extrabold text-[#1D1D1F]">Fırsat Bulunamadı</h3>
            </div>
            <button 
              onClick={handleClose}
              className="w-8 h-8 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8ED] flex items-center justify-center text-gray-500 hover:text-black transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-6 space-y-4 text-center">
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed font-medium">
              Aktif bir fırsat bulunamadı. Bu işlem için önce hasta kaydının fırsatla eşleşmesi gerekiyor.
            </p>
            <button
              onClick={handleClose}
              className="w-full py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white text-[12px] font-bold rounded-xl transition-all cursor-pointer"
            >
              Kapat
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

function getFormContextString(crm: any, prefillHeader?: string): string {
  if (!crm?.formFields) return prefillHeader || "";
  const parts: string[] = [];
  
  if (prefillHeader) {
    parts.push(prefillHeader);
    parts.push(""); // spacer line
  }

  const fields = crm.formFields;
  const isValidValue = (val: any) => {
    if (val === null || val === undefined) return false;
    const str = String(val).trim();
    if (str === "" || str.toLowerCase() === "none" || str.toLowerCase() === "null" || str.toLowerCase() === "undefined") {
      return false;
    }
    return true;
  };

  if (isValidValue(fields.formComplaint)) parts.push(`Şikayet: ${fields.formComplaint}`);
  if (isValidValue(fields.formAge)) parts.push(`Yaş: ${fields.formAge}`);
  if (isValidValue(fields.formCountry)) parts.push(`Konum: ${fields.formCountry}`);
  if (isValidValue(fields.formDepartment)) parts.push(`Bölüm: ${fields.formDepartment}`);
  if (isValidValue(fields.formAppointmentPref)) parts.push(`Randevu isteği: ${fields.formAppointmentPref}`);

  return parts.join("\n");
}

  const prefill = resolveSchedulingPrefill({
    messages,
    crmData: crm,
    referenceDate: new Date()
  });

  switch (modalType) {
    case "call_plan":
      return (
        <PhoneCallModal
          isOpen={true}
          onClose={handleClose}
          opportunityId={oppId}
          tenantSlug={tenantSlug}
          patientName={patientName}
          phoneNumber={phoneNumber}
          activeContact={crm?.opportunity}
          fallback={{ conversationId, phoneNumber }}
          defaultNote={getFormContextString(crm, undefined)}
          prefill={prefill}
        />
      );

    case "appointment_plan":
      return (
        <AppointmentModal
          isOpen={true}
          onClose={handleClose}
          opportunityId={oppId}
          tenantSlug={tenantSlug}
          patientName={patientName}
          phoneNumber={phoneNumber}
          activeContact={crm?.opportunity}
          fallback={{ conversationId, phoneNumber }}
          defaultNote={getFormContextString(crm, undefined)}
          prefill={prefill}
        />
      );

    case "reminder_plan":
      return (
        <FollowUpReminderModal
          isOpen={true}
          onClose={handleClose}
          opportunityId={oppId}
          tenantSlug={tenantSlug}
          patientName={patientName}
          phoneNumber={phoneNumber}
          activeContact={crm?.opportunity}
          fallback={{ conversationId, phoneNumber }}
          defaultNote={getFormContextString(crm, undefined)}
          prefill={prefill}
        />
      );

    case "form_detail":
      if (!crm?.formData) {
        return createPortal(
          <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999]" onClick={handleClose}>
            <div 
              className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-sm overflow-hidden flex flex-col mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 flex justify-between items-center bg-slate-50/50 border-b border-black/[0.05]">
                <div className="flex items-center gap-2 text-zinc-700">
                  <AlertCircle className="w-5 h-5 text-gray-500" />
                  <h3 className="text-sm font-extrabold text-[#1D1D1F]">Form Bulunamadı</h3>
                </div>
                <button onClick={handleClose} className="w-8 h-8 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8ED] flex items-center justify-center text-gray-500 hover:text-black transition-all cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 space-y-4 text-center">
                <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed font-medium">
                  Bu konuşma ile eşleşen bir form kaydı bulunamadı.
                </p>
                <button onClick={handleClose} className="w-full py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white text-[12px] font-bold rounded-xl transition-all cursor-pointer">
                  Kapat
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      }
      return (
        <PatientFormModal
          isOpen={true}
          onClose={handleClose}
          formData={{
            name: crm.formData?.name || "İsimsiz Form",
            date: crm.formData?.date || "Belirtilmemiş",
            raw: crm.formData?.raw,
            formComplaint: crm.formFields?.formComplaint,
            formReportStatus: crm.formFields?.formReportStatus,
            formAppointmentPref: crm.formFields?.formAppointmentPref,
            formAge: crm.formFields?.formAge,
            formDepartment: crm.formFields?.formDepartment,
          }}
          patientName={patientName}
        />
      );

    case "bot_handoff":
      return (
        <BotHandoffModal
          isOpen={true}
          onClose={handleClose}
          conversationId={conversationId}
          patientName={patientName}
          targetState={activeModal.payload?.targetState ?? true}
        />
      );

    case "draft_preview":
      return (
        <DraftPreviewModal
          isOpen={true}
          onClose={handleClose}
          conversationId={conversationId}
          patientName={patientName}
        />
      );

    default:
      return null;
  }
}
