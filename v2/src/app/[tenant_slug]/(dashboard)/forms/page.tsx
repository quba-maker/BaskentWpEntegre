"use client";

import { useState } from "react";
import { CheckCircle2, X, XCircle, RefreshCw } from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import { useInboxStore } from "@/store/inbox-store";
import { useFormsList } from "@/components/features/forms/hooks/useFormsList";
import { useFormDetailState } from "@/components/features/forms/hooks/useFormDetailState";
import { FormFiltersBar } from "@/components/features/forms/FormFiltersBar";
import { FormStatsTabs } from "@/components/features/forms/FormStatsTabs";
import { FormListTable } from "@/components/features/forms/FormListTable";
import { FormDetailModal } from "@/components/features/forms/FormDetailModal";
import { BulkQueueModal } from "@/components/features/forms/BulkQueueModal";
import { getDisplayName, getAllPhones } from "@/components/features/forms/utils";

// Action Imports
import { updateLeadStage, updateLeadNotes } from "@/app/actions/forms";
import { 
  sendFormGreetingTemplateAction, 
  logWhatsappAppOpenedForGreetingAction, 
  saveGreetingDraftInternal, 
  logCallReached, 
  logCallMissed, 
  logCallbackScheduled, 
  logNotInterested, 
  activateBot, 
  prepareBulkSmartGreetingDraftsAction 
} from "@/app/actions/outreach";

export default function FormsPage() {
  const router = useRouter();
  const params = useParams();
  const tenantId = (typeof params.tenant_slug === 'string' ? params.tenant_slug : '') || '';
  const { setActiveContact } = useInboxStore();

  const {
    searchInput,
    setSearchInput,
    sourceFilter,
    setSourceFilter,
    firstContactFilter,
    setFirstContactFilter,
    leadStageFilter,
    setLeadStageFilter,
    selectedLeadIds,
    setSelectedLeadIds,
    isSyncing,
    syncProgress,
    handleSync,
    statusCounts,
    syncMetadata,
    clearSyncProgress,
    forms,
    size,
    setSize,
    isLoading,
    isLoadingMore,
    isReachingEnd,
    mutate
  } = useFormsList();

  const [selectedForm, setSelectedForm] = useState<any>(null);

  const detailState = useFormDetailState(selectedForm, mutate);

  const returnParams = new URLSearchParams({
    returnTo: 'forms',
    selectedLeadId: selectedForm?.id || '',
    search: searchInput,
    source: sourceFilter,
    firstContact: firstContactFilter,
    leadStage: leadStageFilter
  }).toString();

  // Bulk manual queue states
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [isPreparingQueue, setIsPreparingQueue] = useState(false);

  const normalizePhoneForWaMe = (p: string) => {
    if (!p) return "";
    let c = p.replace(/[\s+\-()]/g, "");
    if (c.startsWith("05") && c.length === 11) return "90" + c.slice(1);
    if (c.startsWith("5") && c.length === 10) return "90" + c;
    return c;
  };

  const handleMessageClick = (form: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const displayName = getDisplayName(form);
    const primaryPhone = getAllPhones(form)[0] || form.phone_number;
    setActiveContact(primaryPhone, {
      id: primaryPhone,
      name: displayName,
      channel: "whatsapp",
      stage: form.stage,
      unread: 0
    });
    router.push(`/${tenantId}/inbox`);
  };

  const handleStageChange = async (form: any, newStage: string) => {
    mutate(
      forms.map((f: any) => f.id === form.id ? { ...f, stage: newStage } : f),
      false
    );
    await updateLeadStage(form.id, newStage);
    mutate();
    if (selectedForm && selectedForm.id === form.id) {
      setSelectedForm({ ...selectedForm, stage: newStage });
    }
  };

  const handleNotesSave = async (notes: string) => {
    await updateLeadNotes(selectedForm.id, notes);
    mutate();
  };

  const handleConfirmSend = async (form: any) => {
    if (!detailState.draftMessage || detailState.draftMessage.trim().length === 0) {
      detailState.setOutreachError('Mesaj metni boş olamaz.');
      return;
    }

    if (!detailState.selectedTemplateId) {
      detailState.setOutreachError('Lütfen bir WhatsApp şablonu seçin.');
      return;
    }

    const tpl = detailState.templates.find(t => t.id === detailState.selectedTemplateId);
    if (!tpl) {
      detailState.setOutreachError('Seçilen şablon bulunamadı.');
      return;
    }

    if (!window.confirm("Bu mesaj hastaya WhatsApp üzerinden gönderilecek. Emin misiniz?")) {
      return;
    }

    detailState.setOutreachLoading('sending');
    detailState.setOutreachError(null);
    try {
      const result = await sendFormGreetingTemplateAction(
        form.id, 
        tpl.id, 
        tpl.name, 
        tpl.language || 'tr', 
        detailState.draftMessage
      );
      if (result.success) {
        detailState.setGreetingSent(true);
        detailState.setIsDraftOpen(false);
        detailState.setDraftMessage(null);
        detailState.setBotNote('');
        detailState.setOutreachSuccess('✅ Karşılama mesajı başarıyla gönderildi.');
        
        await handleStageChange(form, 'contacted');
        await detailState.loadOutreachTimeline(form.id);
      } else {
        detailState.setOutreachError(result.error || 'Mesaj gönderilemedi.');
      }
    } catch (err: any) {
      detailState.setOutreachError(err?.message || 'Beklenmeyen bir hata oluştu.');
    } finally {
      detailState.setOutreachLoading(null);
    }
  };

  const handleOpenWhatsAppApp = async (form: any) => {
    if (!detailState.draftMessage || detailState.draftMessage.trim().length === 0) {
      detailState.setOutreachError('Mesaj metni boş olamaz.');
      return;
    }

    const targetPhone = detailState.selectedPhone || detailState.readiness?.recommendedPhone?.phone || form.phone_number;
    if (!targetPhone) {
      detailState.setOutreachError('Telefon numarası eksik.');
      return;
    }

    const cleanPhone = normalizePhoneForWaMe(targetPhone);
    if (cleanPhone.length < 10) {
      detailState.setOutreachError('Geçerli bir telefon numarası bulunamadı.');
      return;
    }

    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(detailState.draftMessage)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');

    detailState.setOutreachLoading('sending');
    detailState.setOutreachError(null);
    detailState.setOutreachSuccess(null);
    try {
      const result = await logWhatsappAppOpenedForGreetingAction(form.id, detailState.draftMessage, { targetPhone });
      if (!result.success) {
        detailState.setOutreachSuccess('WhatsApp açıldı, ancak log kaydedilemedi.');
      } else {
        detailState.setOutreachSuccess('WhatsApp başarıyla açıldı.');
        await detailState.loadOutreachTimeline(form.id);
      }
    } catch (_) {
      detailState.setOutreachSuccess('WhatsApp açıldı, ancak log kaydedilemedi.');
    } finally {
      detailState.setOutreachLoading(null);
    }
  };

  const handleSaveInternal = async (form: any) => {
    if (!detailState.draftMessage || detailState.draftMessage.trim().length === 0) {
      detailState.setOutreachError('Mesaj metni boş olamaz.');
      return;
    }
    detailState.setOutreachLoading('sending');
    detailState.setOutreachError(null);
    detailState.setOutreachSuccess(null);
    try {
      const result = await saveGreetingDraftInternal(form.id, detailState.draftMessage, detailState.botNote, detailState.selectedPhone || undefined);
      if (result.success) {
        detailState.setGreetingSent(true);
        detailState.setIsDraftOpen(false);
        detailState.setDraftMessage(null);
        detailState.setBotNote('');
        detailState.setOutreachSuccess('✅ Taslak başarıyla iç not olarak kaydedildi.');
        await detailState.loadOutreachTimeline(form.id);
      } else {
        detailState.setOutreachError(result.error || 'Taslak kaydedilemedi.');
      }
    } catch (err: any) {
      detailState.setOutreachError(err?.message || 'Beklenmeyen bir hata oluştu.');
    } finally {
      detailState.setOutreachLoading(null);
    }
  };

  const handleCallAction = async (action: 'reached' | 'missed' | 'callback' | 'not_interested', form: any) => {
    detailState.setOutreachLoading('call_action');
    detailState.setOutreachError(null);
    detailState.setOutreachSuccess(null);
    try {
      let result;
      switch (action) {
        case 'reached':
          result = await logCallReached(form.id, detailState.callActionNote || undefined);
          break;
        case 'missed':
          result = await logCallMissed(form.id, detailState.callActionNote || undefined);
          break;
        case 'callback':
          result = await logCallbackScheduled(form.id, detailState.callActionNote || undefined);
          break;
        case 'not_interested':
          result = await logNotInterested(form.id, detailState.callActionNote || undefined);
          break;
      }
      if (result?.success) {
        detailState.setOutreachSuccess('İşlem başarıyla kaydedildi.');
        detailState.setCallActionNote('');
        detailState.setShowCallActions(false);
        await detailState.loadOutreachTimeline(form.id);
        mutate();
      } else {
        detailState.setOutreachError(result?.error || 'İşlem kaydedilemedi.');
      }
    } catch (err: any) {
      detailState.setOutreachError(err?.message || 'Beklenmeyen bir hata oluştu.');
    } finally {
      detailState.setOutreachLoading(null);
    }
  };

  const handleOutreachBotActivate = async (form: any) => {
    detailState.setOutreachLoading('bot');
    detailState.setOutreachError(null);
    try {
      const result = await activateBot(form.id);
      if (result.success) {
        setSelectedForm({ ...form, isBotActive: true });
        mutate(
          forms.map((f: any) => f.id === form.id ? { ...f, isBotActive: true } : f),
          false
        );
        await detailState.loadOutreachTimeline(form.id);
      } else {
        detailState.setOutreachError(result.error || 'Bot aktifleştirilemedi.');
      }
    } catch (err: any) {
      detailState.setOutreachError(err?.message || 'Beklenmeyen bir hata oluştu.');
    } finally {
      detailState.setOutreachLoading(null);
    }
  };

  const handleUpdateQueueItemDraftText = (index: number, newText: string, newSource?: string) => {
    const updated = [...queueItems];
    if (updated[index]) {
      updated[index].draftText = newText;
      updated[index].source = newSource || "Manuel düzenlenmiş taslak";
      setQueueItems(updated);
    }
  };

  const handleBulkQueueStart = async () => {
    if (selectedLeadIds.length === 0) return;
    setIsPreparingQueue(true);
    setIsQueueModalOpen(true);
    try {
      const result: any = await prepareBulkSmartGreetingDraftsAction(selectedLeadIds);
      const queueItemsRaw = result?.data?.queueItems ?? result?.queueItems ?? [];

      if (!result.success || queueItemsRaw.length === 0) {
        alert("Seçilen kayıtlar toplu karşılama kuyruğuna uygun değil.");
        setIsQueueModalOpen(false);
        return;
      }

      const hasEligible = queueItemsRaw.some((qItem: any) => qItem.isEligible === true);
      if (!hasEligible) {
        alert("Seçilen kayıtlar toplu karşılama kuyruğuna uygun değil.");
        setIsQueueModalOpen(false);
        return;
      }

      const items = queueItemsRaw.map((qItem: any) => {
        const lead = forms.find((f: any) => f.id === qItem.id || f.id === qItem.leadId);
        let status = qItem.status || 'Hazır';
        let reason = qItem.reason || '';

        if (!normalizePhoneForWaMe(lead?.phone_number || qItem.phone)) {
          status = 'Eksik Telefon';
          qItem.isEligible = false;
          reason = 'Geçersiz veya eksik telefon numarası';
        }

        return {
          ...qItem,
          patient_name: lead?.patient_name || qItem.name || 'Bilinmiyor',
          phone: lead?.phone_number || qItem.phone || '',
          status,
          reason,
          source: qItem.source || 'AI taslak'
        };
      });

      setQueueItems(items);
      setCurrentQueueIndex(0);
    } catch (err) {
      console.error(err);
      setIsQueueModalOpen(false);
    } finally {
      setIsPreparingQueue(false);
    }
  };

  const handleOpenNextInQueue = async (action: 'open' | 'skip') => {
    if (currentQueueIndex >= queueItems.length) return;
    
    const currentItem = queueItems[currentQueueIndex];
    const newItems = [...queueItems];
    
    if (action === 'skip' || currentItem.status !== 'Hazır') {
      newItems[currentQueueIndex].status = currentItem.status !== 'Hazır' ? currentItem.status : 'Atlandı';
      setQueueItems(newItems);
      setCurrentQueueIndex(prev => prev + 1);
      return;
    }

    const cleanPhone = normalizePhoneForWaMe(currentItem.phone);
    const draftText = currentItem.draftText || "";
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(draftText)}`;
    
    window.open(waUrl, '_blank', 'noopener,noreferrer');

    newItems[currentQueueIndex].status = "WhatsApp'ta açıldı";
    setQueueItems(newItems);

    logWhatsappAppOpenedForGreetingAction(currentItem.id, draftText, {
      source: 'forms_bulk_manual_queue',
      queue_index: currentQueueIndex + 1,
      queue_total: queueItems.length
    }).catch(console.error);

    setCurrentQueueIndex(prev => prev + 1);
  };

  const hasFiltersActive = sourceFilter !== 'all' || firstContactFilter !== 'all' || leadStageFilter !== 'all' || searchInput.trim() !== "";

  return (
    <div className="w-full max-w-[1700px] mx-auto p-4 md:p-8 h-full flex flex-col relative overflow-hidden text-left animate-in fade-in duration-200">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#007AFF]/5 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[#5856D6]/5 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* Filters Bar */}
      <FormFiltersBar
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        sourceFilter={sourceFilter}
        setSourceFilter={setSourceFilter}
        firstContactFilter={firstContactFilter}
        setFirstContactFilter={setFirstContactFilter}
        leadStageFilter={leadStageFilter}
        setLeadStageFilter={setLeadStageFilter}
        isSyncing={isSyncing}
        syncProgress={syncProgress}
        handleSync={handleSync}
        syncMetadata={syncMetadata}
      />

      {/* Bulk actions queue bar */}
      {selectedLeadIds.length > 0 && (
        <div className="mb-4 bg-[#007AFF]/10 border border-[#007AFF]/20 rounded-xl p-3 flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center gap-3 text-[#007AFF]">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-semibold text-sm">{selectedLeadIds.length} kişi seçildi</span>
          </div>
          <button
            onClick={handleBulkQueueStart}
            className="px-4 py-1.5 bg-[#007AFF] text-white text-sm font-semibold rounded-lg hover:bg-[#0056b3] transition-colors shadow-sm cursor-pointer"
          >
            Seçilenleri Manuel Karşılama Kuyruğuna Al
          </button>
        </div>
      )}

      {/* Contact Status Tabs */}
      <FormStatsTabs
        firstContactFilter={firstContactFilter}
        setFirstContactFilter={setFirstContactFilter}
        statusCounts={statusCounts}
      />

      {/* Forms Table list */}
      <FormListTable
        forms={forms}
        isLoading={!!isLoading}
        isLoadingMore={!!isLoadingMore}
        isReachingEnd={!!isReachingEnd}
        size={size}
        setSize={setSize}
        selectedLeadIds={selectedLeadIds}
        setSelectedLeadIds={setSelectedLeadIds}
        onSelectForm={(f) => {
          setSelectedForm(f);
        }}
        onStageChange={handleStageChange}
        onMessageClick={handleMessageClick}
        onPrepareDraft={(f) => {
          setSelectedForm(f);
          detailState.setIsDraftOpen(true);
          detailState.handlePrepareDraft(f);
        }}
        hasFiltersActive={hasFiltersActive}
        onRetry={mutate}
      />

      {/* Lazy details Modal Wrapper */}
      {selectedForm && (
        <FormDetailModal
          form={selectedForm}
          onClose={() => setSelectedForm(null)}
          selectedPhone={detailState.selectedPhone}
          setSelectedPhone={detailState.setSelectedPhone}
          detailData={detailState.detailData}
          detailLoading={detailState.detailLoading}
          outreachTimeline={detailState.outreachTimeline}
          outreachLoading={detailState.outreachLoading}
          setOutreachLoading={detailState.setOutreachLoading}
          outreachError={detailState.outreachError}
          setOutreachError={detailState.setOutreachError}
          outreachSuccess={detailState.outreachSuccess}
          setOutreachSuccess={detailState.setOutreachSuccess}
          greetingSent={detailState.greetingSent}
          setGreetingSent={detailState.setGreetingSent}
          draftMessage={detailState.draftMessage}
          setDraftMessage={detailState.setDraftMessage}
          isDraftOpen={detailState.isDraftOpen}
          setIsDraftOpen={detailState.setIsDraftOpen}
          templates={detailState.templates}
          selectedTemplateId={detailState.selectedTemplateId}
          setSelectedTemplateId={detailState.setSelectedTemplateId}
          callActionNote={detailState.callActionNote}
          setCallActionNote={detailState.setCallActionNote}
          showCallActions={detailState.showCallActions}
          setShowCallActions={detailState.setShowCallActions}
          botNote={detailState.botNote}
          setBotNote={detailState.setBotNote}
          readiness={detailState.readiness}
          readinessLoading={detailState.readinessLoading}
          techOpen={detailState.techOpen}
          setTechOpen={detailState.setTechOpen}
          draftSuccessTemp={detailState.draftSuccessTemp}
          tenantSlug={tenantId}
          returnParams={returnParams}
          onPrepareDraft={detailState.handlePrepareDraft}
          onConfirmSend={handleConfirmSend}
          onOpenWhatsAppApp={handleOpenWhatsAppApp}
          onSaveInternal={handleSaveInternal}
          onCancelDraft={detailState.handleCancelDraft}
          onCallAction={handleCallAction}
          onTemplateSelect={detailState.handleTemplateSelect}
          onOutreachBotActivate={handleOutreachBotActivate}
          onNotesSave={handleNotesSave}
          onStageChange={handleStageChange}
        />
      )}

      {/* Bulk Queue Modal */}
      <BulkQueueModal
        isOpen={isQueueModalOpen}
        onClose={() => {
          setIsQueueModalOpen(false);
          setSelectedLeadIds([]);
        }}
        queueItems={queueItems}
        currentQueueIndex={currentQueueIndex}
        isPreparingQueue={isPreparingQueue}
        onOpenNext={handleOpenNextInQueue}
        onComplete={() => {
          setIsQueueModalOpen(false);
          setSelectedLeadIds([]);
          mutate();
        }}
        templates={detailState.templates}
        onUpdateDraftText={handleUpdateQueueItemDraftText}
      />

      {/* Sync progress centered modal notification */}
      {(isSyncing || syncProgress.status === 'completed' || syncProgress.status === 'error') && (
        <>
          {/* Overlay Background */}
          <div 
            className="fixed inset-0 bg-black/45 backdrop-blur-sm z-[100] transition-opacity animate-in fade-in duration-200"
            onClick={isSyncing ? undefined : clearSyncProgress}
          />
          {/* Centered Modal Card */}
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-black/5 p-6 text-center relative overflow-hidden animate-in zoom-in-95 duration-200 pointer-events-auto text-left flex flex-col gap-3">
              
              {!isSyncing && (
                <button 
                  onClick={clearSyncProgress}
                  className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors w-6 h-6 flex items-center justify-center rounded-full hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              <div className="text-center">
                {isSyncing ? (
                  <RefreshCw className="w-12 h-12 text-blue-500 mx-auto mb-2.5 animate-spin" />
                ) : syncProgress.status === 'completed' ? (
                  <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2.5" />
                ) : (
                  <XCircle className="w-12 h-12 text-rose-500 mx-auto mb-2.5" />
                )}
                
                <h3 className={`text-base font-bold uppercase tracking-wider ${
                  isSyncing ? 'text-blue-600' : syncProgress.status === 'completed' ? 'text-emerald-600' : 'text-rose-600'
                }`}>
                  {isSyncing ? 'Senkronize Ediliyor' : syncProgress.status === 'completed' ? 'Senkronizasyon Tamamlandı' : 'Senkronizasyon Başarısız'}
                </h3>
              </div>

              {isSyncing ? (
                <div className="space-y-3 my-2 text-center">
                  <p className="text-xs font-semibold text-slate-600">
                    {syncProgress.message || 'Lütfen bekleyin...'}
                  </p>
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden border border-slate-100 shadow-inner">
                    <div 
                      className="bg-blue-600 h-full rounded-full transition-all duration-300"
                      style={{ width: `${syncProgress.progress}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-slate-400">
                    %{syncProgress.progress} tamamlandı
                  </span>
                </div>
              ) : syncProgress.status === 'completed' ? (
                <>
                  <div className="space-y-2 my-2 p-4 bg-slate-50 border border-slate-100 rounded-xl text-xs font-semibold text-slate-600">
                    <div className="flex justify-between">
                      <span>Yeni kayıt:</span>
                      <span className="text-slate-900 font-bold">{syncProgress.stats?.created ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Güncellenen kayıt:</span>
                      <span className="text-slate-900 font-bold">{syncProgress.stats?.updated ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Atlanan kayıt:</span>
                      <span className="text-slate-900 font-bold">{syncProgress.stats?.duplicates ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Hatalı kayıt:</span>
                      <span className={`${syncProgress.stats?.errors ? 'text-rose-600 font-bold' : 'text-slate-900 font-bold'}`}>
                        {syncProgress.stats?.errors ?? 0}
                      </span>
                    </div>
                    <div className="border-t border-slate-200/60 pt-2 flex justify-between text-[10px] text-slate-400 font-medium">
                      <span>Süre:</span>
                      <span>{syncProgress.stats?.duration ?? '0'} sn</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#86868B] font-medium leading-relaxed italic bg-blue-50/50 border border-blue-100/50 rounded-xl p-2.5">
                    💡 Yeni kayıtlar başarıyla alındı. Mevcut filtre veya arama kriterleriniz nedeniyle bazı yeni kayıtlar listede görünmeyebilir.
                  </p>
                  <p className="text-xs text-emerald-600 font-bold text-center mt-1">
                    Form listesi güncellendi.
                  </p>
                </>
              ) : (
                <p className="text-xs font-medium text-rose-900 bg-rose-50 border border-rose-100 rounded-xl p-3 my-2 leading-relaxed text-left max-h-32 overflow-y-auto">
                  {syncProgress.message}
                </p>
              )}

              {!isSyncing && (
                <button
                  onClick={clearSyncProgress}
                  className="mt-2 w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer border border-black/5 text-center"
                >
                  Kapat
                </button>
              )}

            </div>
          </div>
        </>
      )}
    </div>
  );
}
