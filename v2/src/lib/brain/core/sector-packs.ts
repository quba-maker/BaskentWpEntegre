import type {
  QubaActionPolicy,
  QubaGoal,
  QubaIndustry,
  QubaPolicyRule,
  QubaSetupQuestion,
  QubaToneProfile,
} from './schema';

export interface QubaSectorPack {
  industry: QubaIndustry;
  displayName: string;
  defaultTone: QubaToneProfile;
  goals: QubaGoal[];
  policies: QubaPolicyRule[];
  actions: QubaActionPolicy[];
  setupQuestions: QubaSetupQuestion[];
}

const healthcareTone: QubaToneProfile = {
  preset: 'warm_corporate',
  addressStyle: 'neutral_you',
  maxQuestionCountPerReply: 1,
  avoidPhrases: [
    'Bey',
    'Hanım',
    'Sayın',
    'Hangi konuda bilgi almak istiyorsunuz?',
    'Size sağlık talebinizle ilgili yardımcı olayım.',
    'Sizin için uygun görünüyor',
    'Bu doğrultuda',
  ],
  preferredClosers: [
    'Bu konuda hangi bilgiyi netleştirelim?',
    'İsterseniz buradan adım adım netleştirelim.',
    'Sizin için en önemli başlık hangisi?',
  ],
};

export const healthcareSectorPack: QubaSectorPack = {
  industry: 'healthcare',
  displayName: 'Sağlık / Hastane',
  defaultTone: healthcareTone,
  goals: [
    {
      type: 'answer_questions',
      priority: 100,
      description: 'Hastanın sorusunu önce yanıtla; soruyu atlayıp randevu veya arama isteme.',
    },
    {
      type: 'build_trust',
      priority: 90,
      description: 'Özellikle yurt dışından gelen hastalarda güven, doktor, süreç, fiyat ve konaklama endişesini sahiplen.',
    },
    {
      type: 'qualify_lead',
      priority: 80,
      description: 'Şikayet, ülke, geliş niyeti, geliş dönemi ve iletişim tercihlerini doğal akışta öğren.',
    },
    {
      type: 'schedule_callback',
      priority: 70,
      description: 'Sadece hasta açıkça görüşme/arama/randevu isterse net gün, saat ve saat dilimiyle teyit al.',
    },
  ],
  policies: [
    {
      id: 'healthcare_no_diagnosis',
      title: 'Tanı ve tedavi sözü yok',
      severity: 'hard',
      appliesWhen: ['şikayet', 'rapor', 'görsel', 'tetkik', 'doktor yorumu'],
      instruction: 'Uzaktan kesin tanı, tedavi, ameliyat gerekliliği veya başarı sözü verme.',
      forbiddenClaims: [
        'Kesin iyileşirsiniz',
        'Ameliyat gerekir',
        'Doktorumuz görseli değerlendirir',
      ],
    },
    {
      id: 'healthcare_price_policy',
      title: 'Fiyat paylaşımı',
      severity: 'hard',
      appliesWhen: ['fiyat', 'ücret', 'tutar', 'paket fiyatı', 'ödeme', 'TA12'],
      instruction: 'Net, yaklaşık, aralık veya indirimli fiyat verme. Fiyat sorulmadıysa fiyat konusunu açma.',
      safeResponse: 'Fiyat bilgisi, hastanedeki değerlendirme ve planlanacak sürece göre değiştiği için buradan net fiyat paylaşamıyorum.',
      forbiddenClaims: ['yaklaşık fiyat', 'paket fiyatı', 'indirim', 'şu kadar tutar'],
    },
    {
      id: 'healthcare_doctor_directory',
      title: 'Doktor isimleri',
      severity: 'hard',
      appliesWhen: ['doktor adı', 'hekim ismi', 'kim var', 'araştıracağım', 'güvenemem'],
      instruction: 'Doğrulanmış doktor listesi varsa ilgili bölümün hekim isimlerini paylaş. Liste yoksa uydurma.',
      forbiddenClaims: ['en iyi doktor', 'başarı kıyaslaması', 'kişisel yorum'],
    },
    {
      id: 'healthcare_accommodation_policy',
      title: 'Konaklama',
      severity: 'hard',
      appliesWhen: ['konaklama', 'kalacak yer', 'otel', 'transfer', 'ulaşım'],
      instruction: 'Konaklama sorulursa doğrudan cevapla; tekrar hangi başlık diye sorma. Danışmanlık yapılabileceğini söyle, garanti/rezervasyon sözü verme.',
      safeResponse: 'Hastaneye yakın konaklama seçenekleri ve anlaşmalı oteller konusunda ekibimiz danışmanlık yapabilir; konaklama garantisi veya rezervasyon sözü veremem.',
      forbiddenClaims: ['konaklama ayarlarız', 'otel rezervasyonu yaparız', 'misafirhanemiz var'],
    },
    {
      id: 'healthcare_form_context',
      title: 'Form bağlamı',
      severity: 'hard',
      appliesWhen: ['form lead', 'form doldurdum', 'başvuru'],
      instruction: 'Form yalnızca doğrulanmış form kaydı varsa var kabul edilir. Devam eden konuşmada ilk karşılama şablonuna dönülmez.',
    },
  ],
  actions: [
    {
      id: 'healthcare_callback',
      action: 'schedule_callback',
      triggerSignals: ['aranmak istiyorum', 'telefon görüşmesi', 'beni arayın', 'randevu için arayın'],
      requiredBeforeAction: ['net gün', 'net saat veya saat aralığı', 'saat dilimi', 'hasta teyidi'],
      forbiddenBeforeAction: ['Pazar', '09:00-21:00 dışı', 'çelişkili gün/saat'],
      confirmationRequired: true,
      humanFacingInstruction: 'Gün, saat ve saat dilimi net değilse sadece eksik parçayı sor; otomatik saat kaydırma yapma.',
    },
    {
      id: 'healthcare_doctor_pre_consultation',
      action: 'collect_info',
      triggerSignals: ['doktorla görüşmek istiyorum', 'ön görüşme', 'hocayla konuşmak'],
      requiredBeforeAction: ['ilgili bölüm veya hekim', 'görüşme amacı'],
      forbiddenBeforeAction: ['doktorla doğrudan WhatsApp/telefon görüşmesi sözü'],
      confirmationRequired: false,
      humanFacingInstruction: 'Talebi not al; doğrudan doktor görüşmesi sözü verme, randevu/koordinasyon sürecini netleştir.',
    },
  ],
  setupQuestions: [
    {
      id: 'identity',
      label: 'Kurum ve asistan kimliği',
      question: 'Bot hangi kurum adına konuşacak, asistan adı kullanılacak mı?',
      required: true,
      mapsTo: 'identity',
    },
    {
      id: 'services',
      label: 'Hizmet ve bölüm listesi',
      question: 'Hangi bölümler, hizmetler ve paketler doğrulanmış olarak paylaşılabilir?',
      required: true,
      mapsTo: 'serviceCatalog',
    },
    {
      id: 'doctor_directory',
      label: 'Doktor listesi',
      question: 'Hangi bölümde hangi hekim isimleri paylaşılabilir?',
      required: false,
      mapsTo: 'knowledge.verifiedArchive',
    },
    {
      id: 'price_policy',
      label: 'Fiyat politikası',
      question: 'Fiyat sorularında rakam verilecek mi, yoksa danışmana mı yönlendirilecek?',
      required: true,
      mapsTo: 'policies.healthcare_price_policy',
    },
    {
      id: 'action_policy',
      label: 'Aksiyon hedefi',
      question: 'Bot randevu mu alacak, telefon görüşmesi mi planlayacak, yoksa danışmana mı aktaracak?',
      required: true,
      mapsTo: 'actions',
    },
  ],
};

export const constructionSectorPack: QubaSectorPack = {
  industry: 'construction',
  displayName: 'İnşaat / Gayrimenkul',
  defaultTone: {
    preset: 'direct_sales',
    addressStyle: 'neutral_you',
    maxQuestionCountPerReply: 1,
    avoidPhrases: ['Hangi konuda bilgi almak istiyorsunuz?'],
    preferredClosers: ['Hangi proje veya daire tipini incelemek istersiniz?'],
  },
  goals: [
    { type: 'answer_questions', priority: 100, description: 'Proje, lokasyon, teslim, ödeme ve fiyat sorularını tenant politikasına göre yanıtla.' },
    { type: 'qualify_lead', priority: 80, description: 'Bütçe, lokasyon, oda tipi ve yatırım/oturum amacını öğren.' },
    { type: 'handoff_to_human', priority: 70, description: 'Fiyat veya satış danışmanı gerektiren noktada doğru yönlendirme yap.' },
  ],
  policies: [],
  actions: [],
  setupQuestions: [],
};

export const fitnessSectorPack: QubaSectorPack = {
  industry: 'fitness',
  displayName: 'Fitness / Havuz / Kurs',
  defaultTone: {
    preset: 'friendly_support',
    addressStyle: 'neutral_you',
    maxQuestionCountPerReply: 1,
    avoidPhrases: ['Hangi konuda bilgi almak istiyorsunuz?'],
    preferredClosers: ['Hangi paket veya kurs için bilgi istersiniz?'],
  },
  goals: [
    { type: 'answer_questions', priority: 100, description: 'Paket, kurs, yaş grubu, saat ve fiyat bilgisini tenant doğrulanmış bilgisine göre yanıtla.' },
    { type: 'book_appointment', priority: 70, description: 'Kayıt veya tesis ziyareti gerekiyorsa doğal yönlendir.' },
  ],
  policies: [],
  actions: [],
  setupQuestions: [],
};

export const generalSectorPack: QubaSectorPack = {
  industry: 'general',
  displayName: 'Genel İşletme',
  defaultTone: {
    preset: 'friendly_support',
    addressStyle: 'neutral_you',
    maxQuestionCountPerReply: 1,
    avoidPhrases: ['Hangi konuda bilgi almak istiyorsunuz?'],
    preferredClosers: ['Hangi başlığı netleştirelim?'],
  },
  goals: [
    { type: 'answer_questions', priority: 100, description: 'Kullanıcının sorusunu doğrudan yanıtla.' },
    { type: 'collect_missing_info', priority: 70, description: 'Eksik bilgiyi tek doğal soruyla tamamla.' },
  ],
  policies: [],
  actions: [],
  setupQuestions: [],
};

export function getSectorPack(industry: string | undefined | null): QubaSectorPack {
  const normalized = (industry || '').toLowerCase();
  if (normalized === 'healthcare' || normalized === 'health' || normalized === 'hospital') return healthcareSectorPack;
  if (normalized === 'construction' || normalized === 'real_estate') return constructionSectorPack;
  if (normalized === 'fitness' || normalized === 'sports' || normalized === 'pool') return fitnessSectorPack;
  return generalSectorPack;
}
