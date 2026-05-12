"use client";

import { useState, useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import { User, MapPin, Building, Activity, Tag, ChevronDown, ChevronRight, Save, X, Plus, ChevronLeft } from "lucide-react";
import { useInboxStore } from "@/store/inbox-store";
import { updateCrmData, addTag, removeTag } from "@/app/actions/inbox";

export function CrmPanel() {
  const { activeContact, mobileView, setMobileView } = useInboxStore();
  const [formOpen, setFormOpen] = useState(false);
  const [stage, setStage] = useState(activeContact?.stage || "new");
  const [department, setDepartment] = useState(activeContact?.department || "");
  const [country, setCountry] = useState(activeContact?.country || "");
  const [isSaving, setIsSaving] = useState(false);
  
  // Tag state
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagVal, setNewTagVal] = useState("");
  const { mutate } = useSWRConfig();

  // Reset local state when contact changes
  useEffect(() => {
    if (activeContact) {
      setStage(activeContact.stage || "new");
      setDepartment(activeContact.department || "");
      setCountry(activeContact.country || "");
      setIsAddingTag(false);
      setNewTagVal("");
    }
  }, [activeContact]);

  if (!activeContact) {
    return <div className="w-[340px] border-l border-white/50 bg-white/40 backdrop-blur-[40px] h-full z-10 hidden lg:block"></div>;
  }

  const handleSave = async () => {
    if (isSaving || !activeContact) return;
    setIsSaving(true);
    
    const res = await updateCrmData(activeContact.id, stage, department, country);
    if (res.success) {
      // Optimistic update of local zustand store
      useInboxStore.getState().setActiveContact(activeContact.id, {
        ...activeContact,
        stage: stage,
        department: department,
        country: country
      });
      // Refresh the contacts list
      mutate((key) => Array.isArray(key) && key[0] === "conversations");
    } else {
      alert("Kaydedilirken bir hata oluştu.");
    }
    
    setIsSaving(false);
  };

  const handleAddTag = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTagVal.trim() || !activeContact) {
      setIsAddingTag(false);
      return;
    }

    const tagText = newTagVal.trim();
    setNewTagVal("");
    setIsAddingTag(false);

    // Optimistically update
    let currentTags = [...parsedTags];
    if (!currentTags.includes(tagText)) currentTags.push(tagText);
    
    useInboxStore.getState().setActiveContact(activeContact.id, {
      ...activeContact,
      tags: JSON.stringify(currentTags)
    });
    
    await addTag(activeContact.id, tagText);
    mutate((key) => Array.isArray(key) && key[0] === "conversations");
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!activeContact) return;
    
    // Optimistically update
    const newTags = parsedTags.filter(t => t !== tagToRemove);
    useInboxStore.getState().setActiveContact(activeContact.id, {
      ...activeContact,
      tags: JSON.stringify(newTags)
    });
    
    await removeTag(activeContact.id, tagToRemove);
    mutate((key) => Array.isArray(key) && key[0] === "conversations");
  };

  // Parse tags safely (handles both JSON array strings and comma separated strings)
  let parsedTags: string[] = [];
  if (activeContact.tags) {
    try {
      parsedTags = JSON.parse(activeContact.tags);
      if (!Array.isArray(parsedTags)) {
        parsedTags = [String(activeContact.tags)];
      }
    } catch {
      parsedTags = String(activeContact.tags).split(',').map(t => t.trim());
    }
  }

  // Parse Form Data safely
  let formDataEntries: { key: string, value: string }[] = [];
  if (activeContact?.formData?.raw) {
    try {
      const rawObj = typeof activeContact.formData.raw === 'string' 
        ? JSON.parse(activeContact.formData.raw) 
        : activeContact.formData.raw;
        
      const skipKeys = ['id', 'leadgen_id', 'form_id', 'ad_id', 'adset_id', 'campaign_id', 'platform', 'is_organic', 'created_time', 'phone_number_id', 'full_name', 'phone_number'];
      
      formDataEntries = Object.entries(rawObj)
        .filter(([k]) => !skipKeys.includes(k.toLowerCase()))
        .map(([k, v]) => ({
          key: k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          value: String(v)
        }));
    } catch (e) {
      console.error("Error parsing form data", e);
    }
  }

  return (
    <div key={activeContact.id} className={`w-full lg:w-[340px] border-l border-white/50 bg-white/40 backdrop-blur-[40px] h-full flex-col overflow-y-auto z-10 shadow-[2px_0_20px_rgba(0,0,0,0.03)] ${mobileView === 'crm' ? 'flex absolute inset-0 lg:relative' : 'hidden lg:flex'}`}>
      
      {/* Mobile Header */}
      <div className="lg:hidden flex-none h-[72px] px-4 border-b border-white/50 flex items-center bg-white/40 sticky top-0 z-20">
        <button 
          onClick={() => setMobileView('chat')}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/50 border border-white/60 shadow-sm"
        >
          <ChevronLeft className="w-5 h-5 text-[#1D1D1F]" />
        </button>
        <span className="ml-3 font-semibold text-[#1D1D1F]">Hasta Profili</span>
      </div>

      {/* Profile Card */}
      <div className="p-8 border-b border-black/5 flex flex-col items-center text-center">
        <div className="w-24 h-24 bg-white/60 rounded-full flex items-center justify-center mb-5 shadow-sm border border-white/80">
          <User className="w-12 h-12 text-[#86868B] opacity-50" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-[#1D1D1F]">{activeContact.name || activeContact.id}</h2>
        <div className="flex items-center gap-2 mt-3 w-full justify-center">
          <div className="relative group">
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <MapPin className="w-3.5 h-3.5 text-[#007AFF]" />
            </div>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="pl-8 pr-6 py-1.5 bg-black/5 hover:bg-black/10 border border-transparent rounded-full text-xs font-semibold text-[#1D1D1F] outline-none transition-all appearance-none cursor-pointer"
            >
              <option value="" disabled>Ülke Seç...</option>
              <option value="Türkiye">Türkiye</option>
              <option value="Almanya">Almanya</option>
              <option value="İngiltere">İngiltere</option>
              <option value="Fransa">Fransa</option>
              <option value="Hollanda">Hollanda</option>
              <option value="Belçika">Belçika</option>
              <option value="Özbekistan">Özbekistan</option>
              <option value="Azerbaycan">Azerbaycan</option>
              <option value="Rusya">Rusya</option>
              <option value="ABD">ABD</option>
              <option value="Diğer">Diğer</option>
            </select>
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <ChevronDown className="w-3 h-3 text-[#86868B]" />
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-7 flex-1">
        
        {/* Core CRM Data */}
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] mb-1.5 block ml-1 flex justify-between">
              Bölüm / Departman
              <span className="text-[8px] text-[#007AFF] bg-[#007AFF]/10 px-1.5 py-0.5 rounded">AI Destekli</span>
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
                <Building className="w-4 h-4 text-[#007AFF] opacity-80" />
              </div>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full bg-white/60 border border-white pl-11 pr-4 py-2.5 rounded-xl text-[14px] font-semibold text-[#1D1D1F] outline-none focus:ring-4 focus:ring-[#007AFF]/20 transition-all appearance-none cursor-pointer shadow-[0_2px_10px_rgba(0,0,0,0.02)]"
              >
                <option value="">Belirtilmemiş</option>
                <option value="Ortopedi">Ortopedi</option>
                <option value="Kardiyoloji">Kardiyoloji</option>
                <option value="Estetik">Estetik</option>
                <option value="Diş">Diş</option>
                <option value="Göz">Göz</option>
                <option value="Tüp Bebek">Tüp Bebek</option>
                <option value="Organ Nakli">Organ Nakli</option>
                <option value="Onkoloji">Onkoloji</option>
                <option value="Obezite">Obezite</option>
                <option value="Nöroloji">Nöroloji</option>
                <option value="Üroloji">Üroloji</option>
                <option value="Check-Up">Check-Up</option>
              </select>
            </div>
          </div>
          
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] mb-1.5 block ml-1">Pipeline Aşaması</label>
            <select 
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="w-full bg-white/60 border border-white px-4 py-2.5 rounded-xl text-[14px] font-semibold text-[#1D1D1F] outline-none focus:ring-4 focus:ring-[#007AFF]/20 transition-all appearance-none cursor-pointer shadow-[0_2px_10px_rgba(0,0,0,0.02)]"
            >
              <option value="new">Yeni Lead</option>
              <option value="contacted">İletişime Geçildi</option>
              <option value="responded">Yanıt Alındı</option>
              <option value="discovery">Keşif / Bilgi</option>
              <option value="appointed">Randevu Aldı</option>
              <option value="lost">Kaybedildi</option>
            </select>
          </div>
        </div>

        {/* Lead Score */}
        <div className="bg-white/60 border border-white rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#34C759] to-transparent opacity-30"></div>
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#34C759]" />
              <span className="text-[13px] font-bold uppercase tracking-wider text-[#86868B]">Lead Skoru</span>
            </div>
            <span className="text-2xl font-black text-[#1D1D1F]">{activeContact.score || 0}</span>
          </div>
          <div className="h-2 w-full bg-black/5 rounded-full overflow-hidden border border-black/5 shadow-inner">
            <div className="h-full bg-gradient-to-r from-[#34C759]/80 to-[#34C759] rounded-full shadow-[0_0_10px_rgba(52,199,89,0.5)]" style={{ width: `${activeContact.score || 0}%` }}></div>
          </div>
        </div>

        {/* Tags */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] ml-1 flex items-center gap-1.5">
              Etiketler
              <span className="text-[8px] text-[#007AFF] bg-[#007AFF]/10 px-1.5 py-0.5 rounded">AI Destekli</span>
            </label>
            {!isAddingTag && (
              <button 
                onClick={() => setIsAddingTag(true)}
                className="text-[#007AFF] hover:text-[#0056b3] transition-colors text-[11px] font-bold tracking-wide flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" /> EKLE
              </button>
            )}
          </div>
          
          <div className="flex flex-wrap gap-2">
            {parsedTags.length > 0 ? (
              parsedTags.map((tag: string, i: number) => (
                <span key={i} className="px-3 py-1 text-xs font-bold bg-[#007AFF]/10 text-[#007AFF] border border-[#007AFF]/20 rounded-lg flex items-center gap-1 shadow-sm group">
                  <Tag className="w-3 h-3" /> {tag}
                  <button 
                    onClick={() => handleRemoveTag(tag)}
                    className="ml-1 w-3.5 h-3.5 rounded-full hover:bg-[#007AFF]/20 flex items-center justify-center opacity-50 hover:opacity-100 transition-all"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))
            ) : (
              !isAddingTag && <span className="text-xs text-[#86868B]">Etiket yok</span>
            )}
            
            {isAddingTag && (
              <form onSubmit={handleAddTag} className="flex items-center">
                <input 
                  autoFocus
                  type="text" 
                  value={newTagVal}
                  onChange={(e) => setNewTagVal(e.target.value)}
                  onBlur={() => handleAddTag()}
                  placeholder="Etiket..."
                  className="px-3 py-1 text-xs font-bold bg-white text-[#1D1D1F] border border-[#007AFF]/30 rounded-lg outline-none focus:ring-2 focus:ring-[#007AFF]/20 shadow-sm w-24"
                />
              </form>
            )}
          </div>
        </div>

        {/* Form History Accordion */}
        {activeContact.formData && (
          <div className="pt-6 border-t border-black/5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] mb-3 block ml-1">Form Geçmişi</label>
            
            <div className="bg-white/60 border border-white rounded-2xl overflow-hidden shadow-[0_2px_15px_rgba(0,0,0,0.03)] transition-all duration-300">
              <button 
                onClick={() => setFormOpen(!formOpen)}
                className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-white/80 transition-colors cursor-pointer"
              >
                <div className="flex flex-col items-start text-left">
                  <span className="text-[14px] font-bold text-[#1D1D1F] line-clamp-1 pr-2">{activeContact.formData.name || "İsimsiz Form"}</span>
                  <span className="text-[11px] text-[#86868B] mt-0.5 font-medium tracking-wide">{activeContact.formData.date}</span>
                </div>
                {formOpen ? <ChevronDown className="w-4 h-4 text-[#86868B] shrink-0" /> : <ChevronRight className="w-4 h-4 text-[#86868B] shrink-0" />}
              </button>
              
              {formOpen && formDataEntries.length > 0 && (
                <div className="px-4 pb-4 pt-1 bg-white/40 border-t border-white/50 space-y-3 max-h-[300px] overflow-y-auto">
                  {formDataEntries.map((entry, idx) => (
                    <div key={idx} className="p-3 bg-white rounded-xl border border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
                      <span className="block text-[10px] font-bold uppercase tracking-widest text-[#86868B] mb-1.5">{entry.key}</span>
                      <span className="text-[13px] font-semibold text-[#1D1D1F] leading-relaxed whitespace-pre-wrap">{entry.value}</span>
                    </div>
                  ))}
                </div>
              )}
              {formOpen && formDataEntries.length === 0 && (
                <div className="px-4 pb-4 pt-1 bg-white/40 border-t border-white/50">
                  <p className="text-xs text-[#86868B] text-center italic py-2">Detaylı yanıt bulunamadı.</p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Save Button */}
      <div className="p-5 border-t border-black/5 bg-white/40 backdrop-blur-[40px] mt-auto">
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="w-full bg-[#1D1D1F] text-white py-3 rounded-xl text-[14px] font-bold hover:scale-[1.02] hover:shadow-[0_8px_20px_rgba(0,0,0,0.15)] transition-all duration-200 flex items-center justify-center gap-2 shadow-md cursor-pointer disabled:opacity-70 disabled:hover:scale-100"
        >
          {isSaving ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
          ) : (
            <Save className="w-4 h-4" />
          )}
          {isSaving ? "Kaydediliyor..." : "Değişiklikleri Kaydet"}
        </button>
      </div>

    </div>
  );
}
