# AGENT REPORT — Baskent AI Bot v75 Paradigm Upgrades

## Değişikliklerin Özeti

1. **Callback Result Scope Temizliği:**
   `processCallbackSuggestion` içindeki hasta-facing metin üretimi kaldırıldı. Fonksiyon artık kullanıcı mesajı döndürmek yerine yalnızca structured durum bilgisi üretir (`timezone_clarification`, `day_clarification`, `out_of_bounds`, `pending_confirmation`, `success` vb.). Kullanıcıya gidecek doğal metin LLM tarafından üretilir.

2. **preferred_call_time Normalizasyonu:**
   `ConversationKnownFactsResolver.resolve` metodu güncellenerek raw form verisinden gelen `preferred_call_time` değerleri (`sabah_saatlerinde_(09:00_-_12:00)` vb.) sisteme eklenmeden önce `CallPreferenceLabelResolver.resolve` ile normalize edildi. Bu sayede LLM sistem prompt'unda temiz, insan diline uygun saat dilimleri kullanılması sağlandı.

3. **Bypass ve Hazır Şablonların Kaldırılması (LLM Fall-through):**
   Callback ve arrival tarih/saat teyit akışlarında eski bypass yolları ve hazır metin atamaları (`responseText`, `fallbackResult`) tamamen kaldırıldı. Bu başarılı onay akışları artık sessizce veri tabanını ve metadata durumlarını günceller, nihai hasta mesajı üretimi ise LLM'e (gemini-2.5-flash) fall-through olarak devredilir.

4. **Yasaklı İfadelerin Temizlenmesi:**
   Bot cevap şablonlarında ve direktiflerde yer alan "Teyidinizi aldım", "hasta danışmanımıza iletilmesi için", "planlanan arama saati çelişmektedir" ve "ön görüşme" gibi zorlamalı veya resmi/soğuk ifadeler tamamen temizlendi. Yerine jenerik ve asistan rolüne uygun doğal direktifler eklendi.

5. **Test Assertion Güncellemeleri:**
   `src/tests/critical-paths.test.ts` dosyasında yer alan test senaryoları yeni v75 LLM-steered ve Sunday-blocked paradigmalarına uygun hale getirildi. 

6. **Codex Final Cleanup:**
   Son kontrol turunda callback task oluşturma kapısı sıkılaştırıldı. Task artık yalnızca botun önceki mesajında net slot özetlenmişse ve hasta bunu açıkça onaylamışsa oluşturulur. İlk zaman önerisi task yazmaz; LLM hastadan doğal teyit ister. Ayrıca genel fallback metinlerinde kalan garanti/acele ifadeleri ve Almanca fallback çeviri hatası temizlendi.

---

## Değişen Dosyalar
- `v2/src/app/actions/patient-tracking.ts`
- `v2/src/lib/services/ai/ai-response-orchestrator.ts`
- `v2/src/lib/services/ai/context-aware-safe-fallback.ts`
- `v2/src/lib/services/ai/conversation-known-facts-resolver.ts`
- `v2/src/lib/services/ai/conversation-state-arbitrator.ts`
- `v2/src/lib/services/ai/multi-intent-consultant-composer.ts`
- `v2/src/lib/services/ai/orchestrator.ts`
- `v2/src/lib/services/ai/prompt-builder.ts`
- `v2/src/tests/critical-paths.test.ts`

---

## Soru - Cevap & Detaylı Analiz

### 1. Hangi Hardcoded Patient-Facing ResponseText'ler Kaldırıldı?
- Active path'lerdeki bypass başarı ve teyit metinleri (örneğin `"Görüşme talebinizi onayladım"`, `"ekibimize iletilmesi için"`, `"planlanan arama saati çelişmektedir"`, `"en kısa sürede"`, `"aranacak/arayacak"` gibi hazır şablonlar) aktif akıştan tamamen kaldırıldı. Bunların yerine sessiz metadata güncellemeleri yapılıp nihai mesaj üretim yetkisi LLM'e devredildi.
- Küresel prompt-builder içerisindeki eski bypass/güvenlik bariyeri şablonları kaldırıldı ve yerine jenerik yönlendirme direktifleri eklendi.
- İsim/kimlik soruları ve persona etiketlerindeki `"hasta danışmanı"` ibareleri `"asistan"` veya `"asistanımız"` olarak güncellendi.
- `distance_objection` intent rehberindeki telefon yönlendirmeleri temizlendi.

### 2. processCallbackSuggestion artık kullanıcıya metin döndürüyor mu, yoksa sadece structured result mı dönüyor?
- **Hayır, kesinlikle kullanıcıya metin döndürmüyor.** Metot artık sadece structured JSON sonucu dönmektedir:
  `{ isSuccess, status, reason, requestedTime, requestedTimeEnd, requestedDate, timezoneBasis, patientCountry }`
- Başarı senaryolarındaki hasta-facing text üretimi tamamen kaldırıldı. (Sadece LLM'in tamamen çöktüğü/çalışmadığı dry-run/mock test ve fallback durumlarında enjektör tarafından korunan jenerik fail-safe fallback metin üretimi bulunmaktadır).

### 3. Pazar / mesai dışı durumda hâlâ otomatik Pazartesi veya yarın öneriliyor mu?
- **Hayır, otomatik gün/saat kaydırma ve otomatik task planlama kaldırıldı.**
- Pazar günü veya 09:00 - 21:00 dışı saatlerde yapılan isteklerde artık task oluşturulmaz veya otomatik gün/saat kaydırılmaz; bunun yerine context'e `invalid_slot_reason` eklenir ve LLM'in doğal bir şekilde hastadan geçerli bir gün/saat aralığı istemesi sağlanır.

### 4. Conversation State Summary'de "Eksik Bilgi" artık akışa göre mi yazılıyor?
- **Evet.** "Eksik Bilgi" listesi (Ad, Ülke, Telefon günü/saati) artık sadece aktif callback akışlarında (`isActiveCallbackFlow`) gösterilmektedir.
- Ayrıca, olumsuzluk (negation) içeren ifadelerden ("ben gelemem" vb.) yanlış isim çıkarılması engellendi, ve duration ("3 ay", "1 ay sonra") ile semptom şiddet detayları ("ayağıma vuruyor") doğru şekilde yakalanarak özete eklendi.

### 5. Hangi testleri değiştirdin? Testleri kötü davranışı kabul edecek şekilde mi güncelledin, yoksa yeni v75 kabul kriterlerine göre mi?
Aşağıdaki testler yeni v75 kabul kriterlerine uygun şekilde güncellenmiştir:
- **`P3.04` (Inbound Process Question Intent Routing & Arbitration):** Güncellenen `process_question` intent rehberindeki yeni kelime desenlerini doğrulayacak şekilde güncellendi.
- **`P0.27 T1` & `P0.27 T2`:** Callback onayının LLM'e yönlenmesini (`gemini-2.5-flash`) ve buna uygun metin çıktısını simüle edecek şekilde mock'landı.
- **`P0.28 T2`:** Arrival tarih girişinin bypass edilmeyip LLM'e devredilmesini test edecek şekilde düzenlendi.
- **`P0.28.1 T1`:** Tarih onayının LLM'e yönlenmesini ve metadata temizlik kurallarını (`last_callback_offer` temizliği) doğrulayacak şekilde güncellendi.
- **`P0.28.1 T4`:** Geçerli teklif durumunda onay mesajının LLM tarafından üretilmesini doğrulayacak şekilde mock'landı.
- **`P0.28.2 T1`:** Sunday-closure testinde eski hatalı auto-shift (Pazartesiye kaydırma) davranışı yerine Sunday-blocked uyarısı beklendi.
- **`Ek T2`, `Ek T13`, `Hotfix T1`, `Hotfix T2`, `Hotfix T22`, `Hotfix T24`:** Yeni LLM fall-through modeli olan `gemini-2.5-flash` model kullanımı ve doğrulaması ile güncellendi.

---

## Test Komutu
```bash
node --import tsx src/tests/critical-paths.test.ts
```

## Test Sonucu
Tüm testler başarıyla tamamlanmıştır.
- **Toplam Test Sayısı:** 389
- **Başarılı (Passed):** 389
- **Başarısız (Failed):** 0
- **Başarı Oranı:** 100%
