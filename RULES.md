# 🚀 ANTIGRAVITY PRODUCT EXECUTION SYSTEM

## Başkent Konya Sağlık Turizmi CRM — AI Kontrollü Geliştirme Protokolü

---

## 🎯 AMAÇ

Bu dokümanın amacı:

* AI’nin (Antigravity / Gemini) **dağınık değil sistematik geliştirme yapmasını sağlamak**
* Mevcut çalışan sistemi **bozmadan evrimleştirmek**
* Her geliştirmeyi:

  * Ölçülebilir
  * Test edilebilir
  * Geri alınabilir
    hale getirmek

---

## ⚠️ ALTIN KURAL

> “Rewrite YOK. Evolution VAR.”

AI ASLA:
❌ Sistemi baştan yazmaz
❌ Büyük kırıcı değişiklik yapmaz
❌ Context’i yok saymaz

AI HER ZAMAN:
✅ Mevcut kodu analiz eder
✅ Üzerine küçük parçalar ekler
✅ Her adımı doğrular
✅ Sonra ilerler

---

## 🧱 1. GELİŞTİRME METODOLOJİSİ (MANDATORY FLOW)

AI her task’ta şu sırayı İZLEMEK ZORUNDA:

### STEP 1 — ANALİZ

* Mevcut kodu oku
* Etkilenecek dosyaları listele
* Riskleri yaz

### STEP 2 — PLAN

* Değişiklikleri küçük parçalara böl
* Her parçayı bağımsız task yap

### STEP 3 — UYGULAMA

* Minimum kod değişikliği ile çöz
* Mevcut fonksiyonları yeniden kullan

### STEP 4 — DOĞRULAMA

* Edge-case düşün
* Hata senaryosu yaz
* Geri dönüşü mümkün mü kontrol et

### STEP 5 — RAPOR

* Ne değişti?
* Neden değişti?
* Sistem nasıl etkilendi?

---

## 🧩 2. MODÜLER GELİŞTİRME PRENSİBİ

Her yeni özellik:

* Tek dosyada izole başlar
* Sonra sisteme entegre edilir

### YANLIŞ:

```js
brain.js içine 500 satır eklemek
```

### DOĞRU:

```js
leadScoringEngine.js
handoverManager.js
conversationPhaseManager.js
```

---

## 🔁 3. MEVCUT SİSTEMLE UYUMLULUK

AI her değişiklikte kontrol eder:

* `brain.js` bozuluyor mu?
* `prompts.js` ile çakışma var mı?
* `follow-up.js` tetiklenmeye devam ediyor mu?
* `lead-webhook.js` akışı korunuyor mu?

Eğer risk varsa:
👉 Önce alternatif çözüm üret

---

## 🧠 4. STATE MANAGEMENT (KRİTİK)

Konuşmalar rastgele yönetilmez.

Her lead için:

```json
{
  "phase": "greeting | discovery | trust | conversion | handover",
  "temperature": "cold | warm | hot",
  "last_action": "asked_question | waiting_response | triggered_human",
  "next_step": "ask | inform | push_to_human"
}
```

AI HER MESAJDA:

* State okur
* State günceller
* State’e göre cevap üretir

---

## 🚨 5. HUMAN HANDOVER SYSTEM

AI kendi sınırını bilir.

### TRIGGER:

* Randevu talebi
* Fiyat sorusu
* Telefon paylaşımı

### AKSİYON:

1. `handoverManager` tetiklenir
2. Lead = HOT
3. Panel alarm
4. Operatöre bildirim
5. AI konuşmayı yavaşlatır

---

## 📡 6. EVENT-DRIVEN ARCHITECTURE

Sistem event bazlı çalışır:

### EVENT ÖRNEKLERİ:

* `lead.created`
* `message.received`
* `lead.warmed`
* `appointment.requested`
* `handover.triggered`

AI her geliştirmede:
👉 Yeni feature’ı event’e bağlamak zorunda

---

## 🧪 7. TEST & VALIDATION KURALLARI

Her değişiklik sonrası:

### CHECKLIST:

* [ ] Eski flow çalışıyor mu?
* [ ] Yeni feature tetikleniyor mu?
* [ ] Edge-case var mı?
* [ ] Loop oluşuyor mu?
* [ ] Duplicate mesaj var mı?

---

## 📊 8. METRİK ODAKLI GELİŞTİRME

AI her feature için:

* Hangi KPI etkilenir?
* Nasıl ölçülür?
* Başarı kriteri nedir?

Örnek:

```
Feature: Yeni ilk mesaj
Metric: Response rate
Target: +%20 artış
```

---

## 🎨 9. UX / UI EVRİM SİSTEMİ

AI tasarım yaparken:

### KURAL:

> “Güzel değil, aksiyon aldıran tasarım”

### ZORUNLU PRENSİPLER:

* Tek ekranda aksiyon
* Minimal bilgi, maksimum yönlendirme
* Renk = durum (kırmızı = sıcak lead)

---

### DASHBOARD YAPISI:

* Üst: Kritik metrikler
* Orta: Funnel
* Alt: Aksiyon listesi

---

### LEAD PANEL:

* Sol: Konuşma
* Sağ: Lead bilgisi
* Üst: Durum & aksiyon butonları

---

## 🔒 10. VERSION CONTROL MANTIĞI

AI her değişiklikte:

* Versiyon numarası artırır
* Changelog yazar

### FORMAT:

```
v1.2.0
- lead scoring eklendi
- handover sistemi geliştirildi
```

---

## 🧭 11. GELİŞTİRME STRATEJİSİ

AI şu sırayla ilerler:

1. Response rate artır
2. Conversation kalitesi artır
3. Handover hızlandır
4. Follow-up güçlendir
5. Show-up artır

---

## 🚫 12. EN BÜYÜK HATALAR

AI ASLA:

❌ Aynı problemi farklı yerlerde çözmez
❌ Hardcode yapmaz
❌ Magic number kullanmaz
❌ Log eklemeden feature yazmaz

---

## 🏁 SON KURAL

> “Çalışan sistemi bozmak başarı değil, geliştirmek başarıdır.”

AI her zaman şu soruyu sorar:

👉 “Bu değişiklik gerçekten dönüşümü artırıyor mu?”

Eğer cevap net değilse:
❌ Yapma
