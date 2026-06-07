import { generateSmartDraft } from "./src/lib/utils/smart-draft-generator";

const s1 = {
  form_name: "Gurbetçiler Form Randevu",
  "yaşınız?": "57",
  "şikayetiniz_nedir?": "Iki diz kikirdak kirecleme ezilmesi",
  "şikayetiniz_ne_zaman_başladı?": "Iki senedir",
  "size_ne_zaman_randevu_oluşturmamızı_istersiniz?": "8",
  "nerede_yaşıyorsunuz?": "Stuttgart",
  "kampanya": "2026_AVRUPA_TR_ORTOPEDI_BF_FUNNEL"
};

const s2 = {
  form_name: "Kardiyoloji Form",
  "şikayetiniz_nedir?": "kontrol",
  "gecmis_islem": "bypass ve stent yapıldı",
  "size_ne_zaman_randevu_oluşturmamızı_istersiniz?": "Ağustos başı"
};

const s3 = {
  form_name: "Beyin Cerrahi Form",
  "şikayetiniz_nedir?": "bel fıtığı ağrı yapıyor",
  "şikayetiniz_ne_zaman_başladı?": "3 aydır"
};

const s4 = {
  form_name: "Genel Başvuru",
  "şikayetiniz_nedir?": "",
  "size_ne_zaman_randevu_oluşturmamızı_istersiniz?": ""
};

console.log("=== SCENARIO 1: ORTHOPEDICS ===");
console.log(generateSmartDraft(s1, "Gurbetçiler Form Randevu"));

console.log("\n=== SCENARIO 2: CARDIOLOGY ===");
console.log(generateSmartDraft(s2, "Kardiyoloji Form"));

console.log("\n=== SCENARIO 3: NEUROSURGERY ===");
console.log(generateSmartDraft(s3, "Beyin Cerrahi Form"));

console.log("\n=== SCENARIO 4: UNKNOWN/VAGUE ===");
console.log(generateSmartDraft(s4, "Genel Başvuru"));
