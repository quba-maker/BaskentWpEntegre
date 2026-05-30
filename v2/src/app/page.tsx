import type { Metadata } from "next";
import Link from "next/link";
import { 
  MessageSquare, 
  Bot, 
  Sparkles, 
  Shield, 
  Users, 
  Calendar, 
  ArrowRight, 
  Lock, 
  CheckCircle2, 
  HelpCircle, 
  Send,
  Workflow
} from "lucide-react";

export const metadata: Metadata = {
  title: "Quba AI | Yapay Zeka Destekli CRM ve WhatsApp Otomasyon Platformu",
  description: "Quba AI; WhatsApp, Instagram, Messenger ve form leadlerini tek panelde toplayan, AI destekli CRM, hasta takibi ve randevu yönetimi platformudur.",
  alternates: {
    canonical: "https://ai.qubamedya.com",
  },
};

export default function LandingPage() {
  // SoftwareApplication JSON-LD Structured Data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Quba AI",
    "applicationCategory": "BusinessApplication",
    "operatingSystem": "Web",
    "url": "https://ai.qubamedya.com",
    "description": "Yapay zeka destekli çok kanallı CRM ve iletişim otomasyon platformu.",
    "provider": {
      "@type": "Organization",
      "name": "Quba Medya",
      "url": "https://www.qubamedya.com"
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-500 selection:text-white relative overflow-x-hidden">
      {/* JSON-LD injection */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Background soft gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] bg-gradient-to-b from-blue-50/50 via-indigo-50/20 to-transparent pointer-events-none -z-10" />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/70 backdrop-blur-md border-b border-slate-200/50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-md shadow-blue-500/20">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">Quba AI</span>
          </div>
          
          <nav className="hidden md:flex items-center gap-8 text-[14px] font-medium text-slate-600">
            <a href="#features" className="hover:text-blue-600 transition-colors">Özellikler</a>
            <a href="#security" className="hover:text-blue-600 transition-colors">Güvenlik</a>
            <a href="#faq" className="hover:text-blue-600 transition-colors">Sıkça Sorulanlar</a>
            <Link href="/legal" className="hover:text-blue-600 transition-colors">Yasal Bilgiler</Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link 
              href="/login" 
              className="px-4 py-2 text-[14px] font-semibold text-slate-700 hover:text-slate-900 transition-colors"
            >
              Giriş Yap
            </Link>
            <a 
              href="mailto:mercan@qubamedya.com?subject=Quba AI Demo Talebi"
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-semibold shadow-sm transition-all hover:shadow-md active:scale-95"
            >
              Demo Talep Et
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-[12px] font-semibold text-blue-700 mb-6 animate-fade-in">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Meta API Uyumlu Yeni Nesil B2B CRM</span>
        </div>
        
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-slate-900 tracking-tight leading-[1.1] max-w-4xl mx-auto">
          Yapay Zeka Destekli <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">CRM &amp; İletişim</span> Otomasyonu
        </h1>
        
        <p className="text-base md:text-lg text-slate-600 mt-6 max-w-2xl mx-auto leading-relaxed">
          Quba AI; WhatsApp, Instagram ve Messenger üzerinden gelen müşteri veya hasta taleplerini tek panelde toplar. Yapay zeka destekli analiz, akıllı randevu ve süreç takip otomasyonu ile operasyon yükünüzü hafifletir.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a 
            href="mailto:mercan@qubamedya.com?subject=Quba AI Demo Talebi"
            className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-lg shadow-blue-500/15 flex items-center justify-center gap-2 group transition-all"
          >
            <span>Platformu Keşfedin (Ücretsiz Demo)</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </a>
          <Link 
            href="/login" 
            className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 font-semibold shadow-sm transition-all"
          >
            Müşteri Girişi
          </Link>
        </div>

        {/* Hero Visual Mockup */}
        <div className="mt-16 relative rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xl shadow-slate-200/50 max-w-5xl mx-auto">
          <div className="rounded-xl border border-slate-100 overflow-hidden bg-slate-900 aspect-[16/9] flex flex-col items-center justify-center text-slate-400 p-8">
            <Workflow className="w-16 h-16 text-blue-500 mb-4 animate-pulse" />
            <h3 className="text-white text-lg font-bold">Çok Kanallı Gelen Kutusu &amp; AI Süreç Yönetimi</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-md">WhatsApp, Instagram ve Messenger mesajları tek bir akıllı panelde güvende ve izole.</p>
          </div>
        </div>
      </section>

      {/* Platform features section */}
      <section id="features" className="bg-white border-y border-slate-200/50 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              İletişim ve Operasyonunuzu Tek Panelden Yönetin
            </h2>
            <p className="text-slate-600 mt-4 leading-relaxed text-sm md:text-base">
              Quba AI, müşterilerinizle olan tüm temas noktalarını tek bir kurumsal platformda birleştirir ve yapay zeka desteğiyle ekibinizin hızını artırır.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all hover:shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                <MessageSquare className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Çok Kanallı Gelen Kutusu</h3>
              <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
                WhatsApp Business, Instagram DM ve Messenger konuşmalarını ekibinizle ortak tek bir gelen kutusunda yönetin.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all hover:shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                <Bot className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">WhatsApp / Instagram / Messenger Lead Yönetimi</h3>
              <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
                Meta kanallarından gelen tüm konuşmaları otomatik olarak müşteri/hasta adayına dönüştürün ve sınıflandırın.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all hover:shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                <Workflow className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Form Lead Takibi</h3>
              <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
                Web sitelerinizden ve reklam formlarından gelen lead verilerini anında sisteme kaydedip takibe alın.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all hover:shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">AI Özet ve Fırsat Analizi</h3>
              <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
                Uzun mesaj geçmişlerini yapay zeka saniyeler içinde özetlesin, müşteri niyetini ve fırsatları anında tespit edin.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all hover:shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                <Users className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Hasta &amp; Müşteri Takip Listesi</h3>
              <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
                Kişiselleştirilmiş takip ve pipeline listesi ile tüm aday süreçlerini gruplandırın, sürtünmeleri en aza indirin.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all hover:shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                <Calendar className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Randevu Yönetimi</h3>
              <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
                Entegre takvim modülü ile randevuları saniyeler içinde planlayın ve işletme içi koordinasyonu eksiksiz sağlayın.
              </p>
            </div>

            {/* Feature 7 */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all hover:shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">İç Telegram Bildirimleri</h3>
              <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
                Yeni leadler ve önemli sistem hareketlerinde ekibinize anlık ve güvenli Telegram bildirimleri gönderin.
              </p>
            </div>

            {/* Feature 8 */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all hover:shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                <Send className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Güvenli Taslak ve Onaylı Gönderim</h3>
              <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
                Yapay zeka tarafından hazırlanan mesaj taslakları, kontrol mekanizmasından geçtikten sonra güvenli şekilde iletilir.
              </p>
            </div>

            {/* Feature 9 */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all hover:shadow-sm">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                <Shield className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Tenant İzolasyonu</h3>
              <p className="text-[13px] text-slate-600 mt-2 leading-relaxed">
                Her işletmenin veritabanı ve API erişimleri tamamen izole edilmiş odalarda saklanır, maksimum güvenlik sunar.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Security-first section */}
      <section id="security" className="py-24 max-w-6xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-[12px] font-semibold text-indigo-700 mb-4">
              <Lock className="w-3.5 h-3.5" />
              <span>Güvenlik ve KVKK Odaklı Altyapı</span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 leading-tight">
              B2B Standartlarında Yüksek Güvenlik Modeli
            </h2>
            <p className="text-slate-600 mt-6 leading-relaxed">
              Quba AI, hassas müşteri ve hasta verilerini korumak için tasarlanmıştır. Platformumuz Meta API kurallarına ve KVKK yönetmeliklerine %100 uyumluluk gösterir.
            </p>

            <div className="space-y-4 mt-8">
              <div className="flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-slate-900 text-sm">Zero-Outbound Güvenlik Modeli</h4>
                  <p className="text-[13px] text-slate-600 mt-1">İşletmenizin onayı ve denetimi olmadan dış dünyaya hiçbir izinsiz mesaj veya veri çıkışı yapılamaz.</p>
                </div>
              </div>
              
              <div className="flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-slate-900 text-sm">Denetimli Yapay Zeka Çıktıları</h4>
                  <p className="text-[13px] text-slate-600 mt-1">Yapay zeka modellerimiz sadece destekleyici analiz üretir; hiçbir medikal teşhis veya tedavi tavsiyesinde bulunmaz.</p>
                </div>
              </div>

              <div className="flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-slate-900 text-sm">Meta Business API Doğrulaması</h4>
                  <p className="text-[13px] text-slate-600 mt-1">Görüşmeler resmi Meta Business API entegrasyonu üzerinden şifreli şekilde yürütülür.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-6 mb-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900">KVKK ve Veri Güvenliği Taahhüdü</h4>
                <p className="text-[12px] text-slate-500 mt-0.5">Sadece işlenen B2B veri kapsamı sınırlarında.</p>
              </div>
            </div>

            <p className="text-[13px] text-slate-600 leading-relaxed">
              Quba AI altyapısında barındırılan tüm müşteri konuşmaları, form verileri ve randevu kayıtları en üst düzey şifreleme ile izole edilmiştir. Sistem üzerindeki AI asistanları tamamen operasyonel hızlandırma amacı gütmekte olup, yasal sorumluluk ve nihai onay her zaman ilgili işletmenin denetimindedir.
            </p>

            <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Sunucu Altyapısı: Vercel &amp; Neon</span>
              <span>KVKK Duyarlı</span>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="bg-slate-100/50 border-t border-slate-200/50 py-24">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">Sıkça Sorulan Sorular</h2>
            <p className="text-slate-600 mt-4">Quba AI platformu hakkında en çok merak edilen konular.</p>
          </div>

          <div className="space-y-6">
            {/* Question 1 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm">
              <h4 className="font-bold text-slate-900 text-base flex gap-3 items-center">
                <HelpCircle className="w-5 h-5 text-blue-600 shrink-0" />
                Quba AI tam olarak nedir ve hangi problemi çözer?
              </h4>
              <p className="text-[14px] text-slate-600 mt-3 pl-8 leading-relaxed">
                Quba AI, işletmelerin WhatsApp, Instagram ve Messenger gibi popüler kanallardan aldığı leadleri tek panelde toplar. Yapay zeka modülü sayesinde konuşmaları özetler, müşteri niyetini analiz eder ve takvime randevuları işler. Böylece satış ve operasyon ekiplerinin hızını artırır.
              </p>
            </div>

            {/* Question 2 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm">
              <h4 className="font-bold text-slate-900 text-base flex gap-3 items-center">
                <HelpCircle className="w-5 h-5 text-blue-600 shrink-0" />
                Yapay zeka kendi kendine müşterilere mesaj gönderebilir mi?
              </h4>
              <p className="text-[14px] text-slate-600 mt-3 pl-8 leading-relaxed">
                Hayır. Zero-outbound güvenlik politikamız gereği, yapay zekanın kendi başına dışarıya izinsiz mesaj gönderme yetkisi yoktur. AI sadece konuşma analizi yapar ve taslak yanıtlar hazırlar. Hazırlanan taslaklar bir insan denetçi tarafından onaylanmadan müşteriye iletilmez.
              </p>
            </div>

            {/* Question 3 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm">
              <h4 className="font-bold text-slate-900 text-base flex gap-3 items-center">
                <HelpCircle className="w-5 h-5 text-blue-600 shrink-0" />
                Sağlık ve medikal alanındaki kullanımlarda sorumluluk kime aittir?
              </h4>
              <p className="text-[14px] text-slate-600 mt-3 pl-8 leading-relaxed">
                Platformumuz tamamen operasyonel iletişim ve CRM koordinasyon amaçlıdır. Yapay zeka modülleri kesinlikle tıbbi teşhis, tedavi önerisi veya medikal yönlendirme yapmaz. Müşterilere veya hastalara verilen nihai bilgilerin doğruluğunu denetlemek tamamen işletmenin kendi yasal sorumluluğundadır.
              </p>
            </div>

            {/* Question 4 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm">
              <h4 className="font-bold text-slate-900 text-base flex gap-3 items-center">
                <HelpCircle className="w-5 h-5 text-blue-600 shrink-0" />
                Verilerimiz nerede barındırılıyor ve KVKK'ya uygun mu?
              </h4>
              <p className="text-[14px] text-slate-600 mt-3 pl-8 leading-relaxed">
                Verileriniz Vercel ve şifreli Neon bulut sunucularında, her tenant için izole edilmiş şekilde saklanır. İşletmelerin kendi son kullanıcılarından gerekli KVKK izinlerini alması kendi yükümlülüklerindedir. İsteyen kullanıcılar `/data-deletion` sayfamızdaki talimatlarla verilerinin silinmesini talep edebilir.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Footer Section */}
      <section className="bg-gradient-to-br from-slate-900 to-slate-950 text-white py-20 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">İletişim Otomasyonunuzu Bugün Başlatın</h2>
          <p className="text-slate-400 mt-4 max-w-xl mx-auto text-sm md:text-base leading-relaxed">
            Quba AI B2B sistemine katılarak ekibinizin müşteri yanıt sürelerini kısaltın ve randevu verimliliğinizi artırın.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a 
              href="mailto:mercan@qubamedya.com?subject=Quba AI Demo Talebi"
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-md transition-all active:scale-95"
            >
              Ücretsiz Demo Talep Et
            </a>
            <Link 
              href="/login" 
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold transition-all"
            >
              Müşteri Girişi
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950 text-slate-500 py-12 border-t border-slate-900 text-xs">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center">
              <Bot className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-white tracking-tight">Quba AI</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link href="/privacy" className="hover:text-white transition-colors">Gizlilik Politikası</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Kullanım Koşulları</Link>
            <Link href="/data-deletion" className="hover:text-white transition-colors">Veri Silme Talimatları</Link>
            <Link href="/legal" className="hover:text-white transition-colors">Yasal Bilgiler</Link>
            <Link href="/support" className="hover:text-white transition-colors">Destek &amp; İletişim</Link>
          </div>

          <div className="text-center md:text-right text-[11px] text-slate-600">
            <p>© 2026 Quba AI. Tüm hakları saklıdır.</p>
            <p className="mt-1">Quba AI, Quba Medya markası altında sunulur.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
