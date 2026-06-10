/**
 * Fallback translation mapping to translate deterministic heuristic texts to Turkish.
 * Runs on both server and client side to translate existing records and new records seamlessly.
 */
export function translateContent(text: string): string {
  if (!text) return '';
  const dictionary: Record<string, string> = {
    // Titles
    'Operator Style Accommodation': 'Operatör Tarzı Kısaltma ve Sadeleştirme',
    'Draft Styling and Concision Rule': 'Operatör Tarzı Kısaltma ve Sadeleştirme',
    'CTA Scheduling Prompt Optimization': 'Randevu CTA Optimizasyonu',
    'Pricing Disclosure Restriction': 'Fiyat Bilgisi Kısıtlaması',
    'Physician Assignment Disclosure Restriction': 'Hekim Atama Bilgisi Kısıtlaması',
    'Persona Signature Minimization': 'Persona ve İmza Sadeleştirmesi',
    'Medical Guideline Association': 'Tıbbi Yönlendirme ve Kılavuz Uyumu',
    'Operator Pricing Reply Framework': 'Operatör Standart Fiyat Yanıt Şablonu',
    'Operator Doctor Scheduling Framework': 'Operatör Standart Hekim Planlama Şablonu',
    'Customer Frustration Signal Avoidance': 'Kullanıcı Memnuniyetsizliği Önleme Uyarısı',
    'Blocked Personal Clinical Instruction': 'Kişisel Klinik Bilgi İçeren Riskli Aday',

    // Summaries
    'Operators significantly changed or shortened the formatting and style of the AI draft.': 'Operatörler yapay zeka taslağını kısalttı veya mesajın dilini sadeleştirdi.',
    'Operators shortened AI response or simplified the language formatting.': 'Operatörler yapay zeka taslağını kısalttı veya mesajın dilini sadeleştirdi.',
    'Operators removed booking invitation or call-back request CTA from drafts.': 'Operatörler randevu davetini veya geri arama isteğini taslaklardan kaldırdı.',
    'Operators removed or modified pricing details from the draft response.': 'Operatörler taslak yanıttan fiyat ayrıntılarını kaldırdı veya değiştirdi.',
    'Operators removed specific doctor names from the draft response.': 'Operatörler taslak yanıttan hekim isimlerini kaldırdı veya değiştirdi.',
    'Operators removed or simplified bot persona introductions or company greetings.': 'Operatörler bot tanıtımlarını veya firma karşılama imzalarını kaldırdı/sadeleştirdi.',
    'AI draft and human final response diverged on clinical descriptions.': 'AI taslağı ve insan yanıtı tıbbi açıklamalarda farklılık gösterdi.',
    'Operators address pricing inquiries with a standard evaluation-first frame.': 'Operatörler fiyat sorularını muayene öncelikli standart bir çerçevede yanıtlıyor.',
    'Operators offer department calendars instead of specific physician commitments.': 'Operatörler doğrudan hekim taahhüdü yerine ilgili bölümün genel takvimini sunuyor.',
    'Conversation resulted in user anger or required immediate operator takeover.': 'Görüşme kullanıcının tepkisine yol açtı veya operatörün anında devralmasını gerektirdi.',
    'Sensitive patient health information or specific single-patient details detected.': 'Tekil hastaya ait hassas klinik bilgi veya kişisel sağlık detayı tespit edildi.',

    // Suggested Rule Texts
    'Prefer concise and direct answers without verbose greeting wrappers.': 'Gereksiz karşılama ifadeleri kullanmadan, kısa ve net cevaplar tercih edin.',
    'Deliver bot responses using a concise, direct, and more natural human tone.': 'Gereksiz karşılama ifadeleri kullanmadan, kısa ve net cevaplar tercih edin.',
    'Avoid repeating call/appointment proposals to users unless explicitly requested.': 'Kullanıcı açıkça talep etmedikçe randevu veya arama tekliflerini tekrarlamaktan kaçının.',
    'Do not state absolute package pricing before physician consultation.': 'Hekim muayenesinden önce net/kesin paket fiyat bilgisi vermeyin.',
    'Do not declare specific physician assignments before clinical triage.': 'Klinik triyaj tamamlanmadan önce kesin hekim ataması beyan etmeyin.',
    'Minimize bot self-identification and greeting signatures per conversation sequence.': 'Görüşme akışlarında botun kendini tanıtma sıklığını ve imza kullanımlarını asgariye indirin.',
    'Verify clinical department mappings and guidelines before confirming procedures.': 'İşlemleri onaylamadan önce klinik bölüm eşlemelerini ve yönergelerini doğrulayın.',
    'When asked about costs, explain that final rates are established after clinical checks.': 'Fiyat sorulduğunda, nihai ücretlerin klinik kontrollerden sonra belirleneceğini açıklayın.',
    'Focus response on clinical division availability instead of pledging specific doctors.': 'Yanıtı tekil hekim taahhütleri yerine klinik birimlerin uygunluğuna odaklayın.',
    'Adjust response tone to be less robotic or escalate to humans immediately.': 'Yanıt tonunu daha az robotik olacak şekilde ayarlayın veya doğrudan insan operatöre yönlendirin.',
    'Clinical treatment or surgery plans must be evaluated manually.': 'Tedavi veya ameliyat planları otomatik öğrenmeye uygun değildir, manuel değerlendirilir.',

    // Evidence Summaries
    'Draft response length was reduced by operator.': 'Taslak yanıt uzunluğu operatör tarafından azaltıldı.',
    "Call/appointment booking prompt was removed by operators.": "Arama/randevu planlama CTA'i operatör tarafından kaldırıldı.",
    'Pricing information was altered by operators.': 'Fiyat bilgisi operatör tarafından değiştirildi.',
    'Physician name reference was altered by operators.': 'Hekim ismi referansı operatör tarafından değiştirildi.',
    'Self-identification persona details were modified in draft.': 'Kendini tanıtma persona detayları taslakta değiştirildi.',
    'Medical claim parameters were modified by operators.': 'Tıbbi iddia parametreleri operatör tarafından değiştirildi.',
    'Operator pricing inquiry response pattern detected.': 'Operatör fiyat sorgusu yanıt kalıbı tespit edildi.',
    'Operator doctor assignment inquiry pattern detected.': 'Operatör hekim atama sorgusu kalıbı tespit edildi.',
    'Negative customer sentiment or takeover signal was recorded.': 'Olumsuz müşteri psikolojisi veya devralma sinyali kaydedildi.',
    'Sensitive single-patient clinical claim detected.': 'Hassas tekil hasta klinik iddiası tespit edildi.'
  };

  if (dictionary[text]) return dictionary[text];

  // Regexp fallback for dynamic changed ratio
  if (text.startsWith("Draft changed ratio was")) {
    const parts = text.match(/Draft changed ratio was ([\d\.]+) \(AI length: (\d+), human length: (\d+)\)/);
    if (parts) {
      return `Taslak yanıt uzunluğu operatör tarafından azaltıldı. (Yapay zeka uzunluğu: ${parts[2]}, insan uzunluğu: ${parts[3]}).`;
    }
  }

  return text;
}
