import { resolvePatientDisplayName, formatPhoneReadable } from "@/lib/utils/patient-name-resolver";
import { resolveCountry, deduplicatePhones, getCountryInfoByName } from "@/lib/utils/country";

export const STAGES = [
  { value: 'new', label: 'Yeni Lead', color: '#007AFF', bg: '#007AFF/10' },
  { value: 'contacted', label: 'İletişime Geçildi', color: '#FF9500', bg: '#FF9500/10' },
  { value: 'responded', label: 'Yanıt Alındı', color: '#34C759', bg: '#34C759/10' },
  { value: 'discovery', label: 'Keşif / Bilgi', color: '#5856D6', bg: '#5856D6/10' },
  { value: 'qualified', label: 'Nitelikli', color: '#30B0C7', bg: '#30B0C7/10' },
  { value: 'appointed', label: 'Randevu Aldı', color: '#0F9D58', bg: '#0F9D58/10' },
  { value: 'lost', label: 'Kaybedildi', color: '#8E8E93', bg: '#8E8E93/10' },
] as const;

export const getStageInfo = (stage: string) => STAGES.find(s => s.value === stage) || STAGES[0];

export const getDisplayName = (form: any): string => {
  if (!form) return "";
  const resolved = resolvePatientDisplayName({
    oppPatientName: form.current_display_name || (form.patient_name !== "İsimsiz Form" ? form.patient_name : undefined),
    convPatientName: form.patient_name !== "İsimsiz Form" ? form.patient_name : undefined,
    whatsappProfileName: form.patient_name !== "İsimsiz Form" ? form.patient_name : undefined,
    formPatientName: form.patient_name !== "İsimsiz Form" ? form.patient_name : undefined,
    formRawDataName: form.raw_data?.full_name || form.raw_data?.['full name'] || form.raw_data?.['Full Name'] || form.raw_data?.['full_name']
  });
  if (resolved === "İsimsiz") {
    const rawFullName = form.raw_data?.full_name || form.raw_data?.['full name'] || form.raw_data?.['Full Name'] || form.raw_data?.['full_name'];
    if (rawFullName && rawFullName.trim()) {
      return rawFullName.trim();
    }
  }
  return resolved;
};

export const getBestDate = (form: any): string => {
  if (!form) return "";
  const rd = form.raw_data || {};
  const ct = rd.created_time || rd.Created_Time || rd.timestamp;
  if (ct) {
    const d = new Date(ct);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return form.created_at || '';
};

export const getAllPhones = (form: any): string[] => {
  if (!form) return [];
  const rd = form.raw_data || {};
  let phones: string[] = [];
  try {
    if (rd._all_phones) {
      const parsed = typeof rd._all_phones === 'string' ? JSON.parse(rd._all_phones) : rd._all_phones;
      if (Array.isArray(parsed) && parsed.length > 0) phones = parsed;
    }
  } catch (_) {}
  if (phones.length === 0) phones = [form.phone_number].filter(Boolean);
  return deduplicatePhones(phones);
};

export const getFormCountry = (form: any): { name: string; flag: string; isEstimated: boolean } | null => {
  if (!form) return null;
  if (form.current_country) {
    const isEstimated = !form.country;
    const info = getCountryInfoByName(form.current_country);
    return info ? { ...info, isEstimated } : null;
  }
  const phones = getAllPhones(form);
  const info = resolveCountry(phones[0] || form.phone_number, form.raw_data);
  return info ? { ...info, isEstimated: true } : null;
};
