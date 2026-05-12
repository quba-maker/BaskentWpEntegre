export const MOCK_CONTACTS = [
  {
    id: "1",
    name: "Ayşe Yılmaz",
    phone: "+90 532 123 4567",
    channel: "whatsapp",
    lastMessage: "Randevu detaylarını alabilir miyim?",
    lastMessageTime: "10:42",
    unread: 2,
    isBotActive: true,
    stage: "Yeni",
    department: "Kardiyoloji",
    score: 85,
    country: "TR"
  },
  {
    id: "2",
    name: "John Doe",
    phone: "IG Kullanıcı",
    channel: "instagram",
    lastMessage: "Fiyat bilgisi verir misiniz lütfen? Çok acil.",
    lastMessageTime: "Dün",
    unread: 0,
    isBotActive: false,
    stage: "İletişime Geçildi",
    department: "Estetik",
    score: 60,
    country: "UK"
  },
  {
    id: "3",
    name: "Mehmet Demir",
    phone: "+90 555 987 6543",
    channel: "whatsapp",
    lastMessage: "Teşekkürler, yarın görüşmek üzere.",
    lastMessageTime: "Pzt",
    unread: 0,
    isBotActive: true,
    stage: "Randevu Aldı",
    department: "Diş",
    score: 95,
    country: "TR"
  }
];

export const MOCK_MESSAGES = [
  {
    id: "m1",
    sender: "bot",
    text: "Merhaba Ayşe Hanım, Başkent Hastanesi'ne hoş geldiniz. Size nasıl yardımcı olabilirim?",
    time: "10:30",
    dateLabel: "Bugün"
  },
  {
    id: "m2",
    sender: "user",
    text: "Kardiyoloji bölümünden randevu almak istiyorum.",
    time: "10:35"
  },
  {
    id: "m3",
    sender: "bot",
    text: "Tabii ki. Hangi gün sizin için uygun olur?",
    time: "10:36"
  },
  {
    id: "m4",
    sender: "user",
    text: "Yarın sabah olabilir mi?",
    time: "10:40"
  },
  {
    id: "m5",
    sender: "user",
    text: "Randevu detaylarını alabilir miyim?",
    time: "10:42"
  }
];
