import { PatientKnownFacts } from './conversation-known-facts-resolver';

export class HealthcareProcessAnswerPolicy {
  /**
   * Detects if the user's input asks about multiple intents (Doctors, Process, Pricing) at once.
   */
  public static isMultiIntentRequest(text: string): boolean {
    const lower = (text || '').toLowerCase().trim();
    const hasDoc = ['doktor', 'hekim', 'uzman', 'cerrah'].some(kw => lower.includes(kw));
    const hasProcess = ['süreç', 'surec', 'nasıl işliyor', 'nasil isliyor', 'işleyiş', 'isleyis', 'nasıl ilerler', 'nasil ilerler'].some(kw => lower.includes(kw));
    const hasPrice = ['fiyat', 'ücret', 'ucret', 'ne kadar', 'tutar', 'kac para', 'maliyet'].some(kw => lower.includes(kw));
    
    // Check if at least two intents are requested together (e.g. process + price, doc + process, etc.)
    const count = (hasDoc ? 1 : 0) + (hasProcess ? 1 : 0) + (hasPrice ? 1 : 0);
    return count >= 2;
  }

  /**
   * Generates a structured multi-intent response adhering to hospital guidelines.
   * Ensures no doctor names or pricing is hallucinated.
   */
  public static getMultiIntentFallbackResponse(
    facts: PatientKnownFacts, 
    hasDoctorDirectory: boolean, 
    doctorListText?: string
  ): string {
    const dept = facts.previousDepartments && facts.previousDepartments.length > 0
      ? facts.previousDepartments[0]
      : (facts.complaint ? `${facts.complaint} için genellikle ilgili uzmanlık alanı` : 'ilgili uzmanlık alanı');
      
    const timePhrase = facts.availableTime ? ` ${facts.availableTime} planınızı da not ettim.` : '';
    
    let docSection = '';
    if (hasDoctorDirectory && doctorListText && doctorListText.trim().length > 0) {
      docSection = `Hizmet veren doğrulanmış hekimlerimizin listesi:\n${doctorListText.trim()}`;
    } else {
      docSection = `${dept} değerlendirmesi gerekir. Hekim listesini bu ekrandan net doğrulayamıyorum ve hatalı bilgi vermemek adına isim uydurmam; ancak danışman ekibimiz uygun hekim seçeneklerini sizin için netleştirecektir.`;
    }
    
    return `Sorularınızı memnuniyetle yanıtlayayım:

*Doktor / bölüm yönlendirmesi*
${docSection}

*Süreç nasıl ilerler*
Varsa güncel MR, tahlil veya raporlarınızı bizimle buradan paylaşabilirsiniz. Ancak kesin değerlendirme hastanede ilgili uzman hekim muayenesi sonrasında yapılır.

*Fiyat neden netleşir / neye göre değişir*
Tedavi ücretleri, yapılacak tetkikler ve hekimimizin belirleyeceği kişiye özel tedavi planına göre değişir. Bu nedenle buradan kesin bir fiyat belirtmemiz doğru olmaz.

*Sonraki adım*${timePhrase} Detayları netleştirmek için hasta danışmanımız ile bilgilendirme amaçlı bir telefon görüşmesi yapmak ister misiniz? 🙏`;
  }
}
