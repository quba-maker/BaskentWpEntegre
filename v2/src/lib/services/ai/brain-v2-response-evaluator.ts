import type { BrainV2ShadowPlan } from './brain-v2-shadow-planner';

export type BrainV2EvaluationStatus = 'pass' | 'warn' | 'fail';

export interface BrainV2ResponseEvaluation {
  version: 'brain_v2_response_eval_v1';
  score: number;
  status: BrainV2EvaluationStatus;
  missingAnswers: string[];
  forbiddenHits: string[];
  qualityWarnings: string[];
  summary: string;
}

function normalizeText(text: string): string {
  return (text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\u0307/g, '')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function includesAny(cleanText: string, needles: string[]): boolean {
  return needles.some(needle => cleanText.includes(normalizeText(needle)));
}

function hasVerifiedDoctorName(plan: BrainV2ShadowPlan, cleanReply: string): boolean {
  const doctors = plan.verifiedFacts.doctorDirectory
    ?.flatMap(block => block.doctors || [])
    ?.filter(Boolean) || [];

  if (doctors.length === 0) return false;
  return doctors.some(name => {
    const cleanName = normalizeText(name);
    const parts = cleanName
      .replace(/\b(prof|doc|dr|uzm|ogr|gor)\b/g, ' ')
      .split(/\s+/)
      .filter(part => part.length >= 3);

    return cleanReply.includes(cleanName) || parts.some(part => cleanReply.includes(part));
  });
}

function planRequires(plan: BrainV2ShadowPlan, phrase: string): boolean {
  return plan.mustAnswer.some(item => normalizeText(item).includes(normalizeText(phrase)));
}

export class BrainV2ResponseEvaluator {
  public static evaluate(reply: string, plan: BrainV2ShadowPlan, inboundText = ''): BrainV2ResponseEvaluation {
    const cleanReply = normalizeText(reply);
    const cleanInbound = normalizeText(inboundText);
    const missingAnswers: string[] = [];
    const forbiddenHits: string[] = [];
    const qualityWarnings: string[] = [];

    if (planRequires(plan, 'fiyat politikas')) {
      const answeredPriceSafely = includesAny(cleanReply, [
        'Fiyat bilgisi, hastanedeki değerlendirme',
        'buradan net fiyat paylaşamıyorum',
        'net fiyat paylaşamıyorum',
      ]);
      if (!answeredPriceSafely) {
        missingAnswers.push('Fiyat sorusu güvenli fiyat politikasıyla yanıtlanmadı');
      }
      if (
        /\b\d{2,}[\s.]*(tl|₺|euro|eur|€|usd|\$)\b/i.test(reply)
        || /\b\d{1,3}\s*(?:bin|milyon)\s*(?:tl|₺|euro|eur|€|usd|\$)?\b/i.test(reply)
      ) {
        forbiddenHits.push('Fiyat sorusunda doğrulanmamış rakam/paylaşım riski');
      }
    }

    if (planRequires(plan, 'doktor adı')) {
      const hasDoctorDirectory = (plan.verifiedFacts.doctorDirectory || []).some(block => (block.doctors || []).length > 0);
      if (hasDoctorDirectory && !hasVerifiedDoctorName(plan, cleanReply)) {
        missingAnswers.push('Doktor adı soruldu ama doğrulanmış listeden isim paylaşılmadı');
      }
      if (hasDoctorDirectory && includesAny(cleanReply, [
        'isimleri yanlış vermek istemem',
        'görüşme sırasında en uygun uzman',
        'hasta danışmanımız bu bilgiyi',
      ])) {
        forbiddenHits.push('Doktor listesi varken eski kaçış cevabı kullanıldı');
      }
    }

    if (planRequires(plan, 'hekim hakkında')) {
      if (!includesAny(cleanReply, ['kişisel yorum', 'başarı kıyaslaması', 'görev yapmaktadır', 'bölümümüzde'])) {
        missingAnswers.push('Hekim profil sorusu güvenli yorum sınırıyla yanıtlanmadı');
      }
    }

    if (planRequires(plan, 'konaklama')) {
      if (!includesAny(cleanReply, ['konaklama', 'kalacak', 'otel'])) {
        missingAnswers.push('Konaklama sorusu yanıtlanmadı');
      }
      if (includesAny(cleanReply, ['en çok hangi başlık', 'hangi başlık sizi düşündürüyor'])) {
        forbiddenHits.push('Konaklama sorulduğu halde aynı başlık tekrar soruldu');
      }
      if (includesAny(cleanReply, ['rezervasyon yaparız', 'konaklama ayarlarız', 'misafirhanemiz var'])) {
        forbiddenHits.push('Konaklama için garanti/rezervasyon vaadi riski');
      }
    }

    if (planRequires(plan, 'süreci kısa')) {
      if (!includesAny(cleanReply, ['muayene', 'değerlendirme', 'tetkik', 'süreç'])) {
        missingAnswers.push('Süreç sorusu kısa şekilde açıklanmadı');
      }
    }

    if (planRequires(plan, 'adres')) {
      if (!includesAny(cleanReply, ['adres', 'konum', 'lokasyon', 'harita'])) {
        missingAnswers.push('Adres/konum talebi yanıtlanmadı');
      }
      if (includesAny(cleanReply, ['rica ederiz', 'iyi günler dileriz']) && !includesAny(cleanReply, ['adres', 'konum', 'harita'])) {
        forbiddenHits.push('Adres talebi teşekkür/kapanış gibi algılandı');
      }
    }

    if (planRequires(plan, 'ülke/dil')) {
      if (includesAny(cleanReply, ['hangi ülkede yaşadığınızı', 'ülkenizi öğrenebilir miyim']) && includesAny(cleanInbound, ['almanya', 'kazakistan', 'ozbekistan', 'özbekistan', 'o\'zbekiston', 'fransa', 'kanada', 'hollanda'])) {
        forbiddenHits.push('Kullanıcının verdiği ülke bilgisi tekrar soruldu');
      }
    }

    if (planRequires(plan, 'geliş bilgisini')) {
      if (includesAny(cleanReply, ['gelme ihtimaliniz olur mu', 'türkiye’ye gelme ihtimaliniz', 'turkiye\'ye gelme ihtimaliniz'])) {
        qualityWarnings.push('Geliş niyeti zaten varken tekrar sorulmuş olabilir');
      }
    }

    if (includesAny(cleanReply, [
      'hangi konuda bilgi almak istiyorsunuz',
      'size sağlık talebinizle ilgili yardımcı olayım',
    ])) {
      forbiddenHits.push('Genel kaçış cevabı kullanıldı');
    }

    if (/\b(Bey|Hanım|Sayın|Bayan|Bay)\b/.test(reply)) {
      qualityWarnings.push('Cinsiyetli/resmi hitap kullanıldı');
    }

    if (includesAny(cleanReply, ['başkent üniversitesi konya hastanesi’nden ben', 'başkent üniversitesi konya hastanesi\'nden ben']) && plan.contactMode === 'continuing_conversation') {
      qualityWarnings.push('Devam eden konuşmada kimlik tekrarı var');
    }

    const score = Math.max(
      0,
      100 - (unique(missingAnswers).length * 20) - (unique(forbiddenHits).length * 25) - (unique(qualityWarnings).length * 8)
    );
    const status: BrainV2EvaluationStatus = score < 70 || forbiddenHits.length > 0
      ? 'fail'
      : score < 90 || missingAnswers.length > 0 || qualityWarnings.length > 0
        ? 'warn'
        : 'pass';

    return {
      version: 'brain_v2_response_eval_v1',
      score,
      status,
      missingAnswers: unique(missingAnswers),
      forbiddenHits: unique(forbiddenHits),
      qualityWarnings: unique(qualityWarnings),
      summary: status === 'pass'
        ? 'Yanıt Brain v2 planındaki ana başlıkları karşıladı.'
        : 'Yanıt Brain v2 planına göre iyileştirme gerektiriyor.',
    };
  }
}
