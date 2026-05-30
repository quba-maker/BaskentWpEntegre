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
  Workflow,
  AlertCircle,
  Clock,
  Layers,
  Search,
  Plus,
  Filter,
  Check,
  TrendingUp,
  Inbox,
  AlertTriangle,
  HeartHandshake,
  Info,
  Trash2
} from "lucide-react";

export const metadata: Metadata = {
  title: "Quba AI | Yapay Zeka Destekli CRM ve WhatsApp Otomasyon Platformu",
  description: "Quba AI; WhatsApp, Instagram, Messenger ve form leadlerini tek panelde toplayan, AI özetleri, hasta/müşteri takibi, randevu yönetimi ve iç bildirimler sunan B2B CRM platformudur.",
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
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] bg-gradient-to-b from-blue-50/60 via-indigo-50/20 to-transparent pointer-events-none -z-10" />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200/50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/quba-logo.svg" alt="Quba AI Logo" className="w-8 h-8 object-contain" />
            <span className="text-lg font-bold tracking-tight text-slate-900">Quba AI</span>
          </div>
          
          <nav className="hidden md:flex items-center gap-6 text-[13px] font-semibold text-slate-600">
            <a href="#problems" className="hover:text-blue-600 transition-colors">Sorunlar</a>
            <a href="#workflow" className="hover:text-blue-600 transition-colors">Akış</a>
            <a href="#modules" className="hover:text-blue-600 transition-colors">Modüller</a>
            <a href="#security" className="hover:text-blue-600 transition-colors">Güvenlik</a>
            <a href="#faq" className="hover:text-blue-600 transition-colors">SSS</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link 
              href="/login" 
              className="px-4 py-2 text-[13px] font-bold text-slate-700 hover:text-slate-900 transition-colors"
            >
              Giriş Yap
            </Link>
            <a 
              href="mailto:mercan@qubamedya.com?subject=Quba AI Demo Talebi"
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-bold shadow-md shadow-blue-500/10 transition-all hover:shadow-lg active:scale-95"
            >
              Demo Talep Et
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-blue-50 border border-blue-100/60 text-[11px] font-bold text-blue-700 mb-6">
          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          <span>AI destekli lead takip ve randevu operasyon platformu</span>
        </div>
        
        <h1 className="text-4xl md:text-5xl lg:text-[54px] font-extrabold text-slate-900 tracking-tight leading-[1.1] max-w-4xl mx-auto">
          Leadleri kaçırmayın. Görüşmeleri, formları ve randevuları <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600">tek panelden</span> yönetin.
        </h1>
        
        <p className="text-base md:text-lg text-slate-600 mt-6 max-w-3xl mx-auto leading-relaxed">
          Quba AI; WhatsApp, Instagram, Messenger ve form leadlerini tek panelde toplar. AI özetleri, hasta/müşteri takibi, randevu yönetimi ve iç bildirimlerle ekibinizin her fırsatı zamanında takip etmesini sağlar.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a 
            href="mailto:mercan@qubamedya.com?subject=Quba AI Demo Talebi"
            className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-lg shadow-blue-500/15 flex items-center justify-center gap-2 group transition-all"
          >
            <span>Demo Talep Et (Ücretsiz Kurulum Planı)</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </a>
          <Link 
            href="/login" 
            className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 font-bold shadow-sm transition-all"
          >
            Müşteri Girişi
          </Link>
        </div>

        {/* Premium Tailwind Mockup Area */}
        <div className="mt-16 relative rounded-2xl border border-slate-200/80 bg-white p-2.5 shadow-2xl shadow-slate-200/60 max-w-5xl mx-auto text-left overflow-hidden">
          <div className="rounded-xl border border-slate-100 bg-slate-900/5 overflow-hidden grid lg:grid-cols-12 min-h-[460px]">
            {/* Sidebar Mockup (2 cols) */}
            <div className="lg:col-span-2 bg-slate-950 text-slate-400 p-4 flex flex-col justify-between border-r border-slate-900 text-xs font-semibold">
              <div className="space-y-6">
                <div className="flex items-center gap-2 text-white border-b border-slate-900 pb-4">
                  <img src="/quba-logo.svg" alt="Logo" className="w-5 h-5" />
                  <span className="font-bold tracking-tight">Quba AI CRM</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-slate-500"><Inbox className="w-4 h-4" /> Gelen Kutusu</div>
                  <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-blue-600/10 text-white"><Users className="w-4 h-4 text-blue-500" /> Hasta Takibi</div>
                  <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-slate-500"><Calendar className="w-4 h-4" /> Randevular</div>
                  <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-slate-500"><Layers className="w-4 h-4" /> Entegrasyonlar</div>
                </div>
              </div>
              <div className="text-[10px] text-slate-700 border-t border-slate-900 pt-4">
                Sürüm v2.0
              </div>
            </div>

            {/* Main CRM View (7 cols) */}
            <div className="lg:col-span-7 bg-white p-5 flex flex-col justify-between border-r border-slate-100">
              <div className="space-y-4">
                {/* Header of Table */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-sm">Aktif Hasta Adayları</h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">Son 24 saatte gelen yeni başvurular</p>
                  </div>
                  <div className="flex gap-2">
                    <div className="px-2.5 py-1 rounded-lg border border-slate-100 bg-slate-50 flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold"><Filter className="w-3 h-3" /> Filtrele</div>
                    <div className="px-2.5 py-1 rounded-lg bg-blue-600 text-white flex items-center gap-1 text-[10px] font-bold"><Plus className="w-3 h-3" /> Hasta Ekle</div>
                  </div>
                </div>

                {/* Table Mockup */}
                <div className="border border-slate-100 rounded-xl overflow-hidden shadow-sm">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold">
                        <th className="p-3">Hasta / Aday</th>
                        <th className="p-3">Kanal</th>
                        <th className="p-3">Aşama</th>
                        <th className="p-3">Son İşlem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      <tr className="bg-blue-50/20">
                        <td className="p-3">
                          <p className="font-bold text-slate-950 text-xs">Elif Yılmaz</p>
                          <p className="text-[9px] text-slate-400 font-normal">+90 554 ••• •• 06</p>
                        </td>
                        <td className="p-3">
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold text-[9px] flex items-center gap-0.5 w-fit"><MessageSquare className="w-2.5 h-2.5" /> WhatsApp</span>
                        </td>
                        <td className="p-3">
                          <span className="px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-[9px]">Sıcak Lead</span>
                        </td>
                        <td className="p-3">
                          <span className="text-[9px] text-slate-500">Randevu Planlandı</span>
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3">
                          <p className="font-bold text-slate-950 text-xs">Sarah Jenkins</p>
                          <p className="text-[9px] text-slate-400 font-normal">+44 7911 ••• •••</p>
                        </td>
                        <td className="p-3">
                          <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold text-[9px] flex items-center gap-0.5 w-fit"><Send className="w-2.5 h-2.5" /> Web Form</span>
                        </td>
                        <td className="p-3">
                          <span className="px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-[9px]">Teyit Bekliyor</span>
                        </td>
                        <td className="p-3">
                          <span className="text-[9px] text-slate-500">AI Özet Üretildi</span>
                        </td>
                      </tr>
                      <tr className="opacity-60">
                        <td className="p-3">
                          <p className="font-bold text-slate-950 text-xs">Mustafa Demir</p>
                          <p className="text-[9px] text-slate-400 font-normal">+90 532 ••• •• 89</p>
                        </td>
                        <td className="p-3">
                          <span className="px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 font-bold text-[9px] flex items-center gap-0.5 w-fit"><Sparkles className="w-2.5 h-2.5" /> Instagram</span>
                        </td>
                        <td className="p-3">
                          <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold">Randevu Alındı</span>
                        </td>
                        <td className="p-3">
                          <span className="text-[9px] text-slate-500">Teyit İletildi</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Randevu Yönetim Paneli Minified */}
              <div className="border border-blue-100 rounded-xl p-3 bg-blue-50/30 flex items-center justify-between mt-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-[11px]">Klinik Randevu Planlayıcı</h4>
                    <p className="text-[9px] text-slate-500 mt-0.5">Elif Yılmaz - 30 Mayıs 2026 Saat 15:30</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded">
                  <Check className="w-3 h-3" /> Teyit Edildi
                </div>
              </div>
            </div>

            {/* AI Assistant Sidebar Mockup (3 cols) */}
            <div className="lg:col-span-3 bg-slate-50 p-5 flex flex-col justify-between">
              <div className="space-y-4">
                {/* AI Header */}
                <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                  <div className="w-5 h-5 rounded-md bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-center shrink-0">
                    <Sparkles className="w-3 h-3 text-white animate-pulse" />
                  </div>
                  <span className="font-bold text-slate-900 text-xs">AI Analiz ve Özet</span>
                </div>

                {/* AI Summary Box */}
                <div className="bg-white border border-slate-200/80 rounded-xl p-3 shadow-sm space-y-2 text-[10px]">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Aday Randevu Teyit</span>
                    <span className="px-1 bg-blue-50 text-blue-600 rounded font-bold">TR</span>
                  </div>
                  <p className="text-slate-700 leading-relaxed font-medium">
                    &quot;Hasta, estetik burun ameliyatı için bilgi edinmek istiyor. 3 adet referans ameliyat görseli iletildi. Randevu onaylandı.&quot;
                  </p>
                  <div className="text-slate-400 flex justify-between border-t border-slate-100 pt-2 text-[9px]">
                    <span>Kanal: WhatsApp</span>
                    <span>İlgi: Ameliyat</span>
                  </div>
                </div>

                {/* Telegram Internal Notification Alert Overlay */}
                <div className="border border-indigo-100 bg-indigo-50/50 rounded-xl p-3 space-y-1.5 shadow-sm text-[10px]">
                  <div className="flex items-center gap-1.5 font-bold text-indigo-900">
                    <Send className="w-3 h-3 text-indigo-600" />
                    <span>Telegram İç Bildirim</span>
                  </div>
                  <p className="text-slate-600 leading-normal text-[9px]">
                    🔔 <strong>[Quba AI Bildirim]</strong> Yeni WhatsApp Lead'i düştü! Elif Yılmaz (+90554•••)
                  </p>
                </div>
              </div>

              {/* Bot status indicators */}
              <div className="text-[10px] text-slate-400 border-t border-slate-200 pt-3 flex items-center justify-between font-semibold">
                <span>AI Motoru: Aktif</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section id="problems" className="bg-slate-100/40 border-t border-slate-200/50 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-red-50 border border-red-100/80 text-[10px] font-bold text-red-600 mb-3">
              <AlertTriangle className="w-3 h-3 text-red-600" />
              <span>Operasyonel Darboğazlar</span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Lead geliyor ama takip süreci dağınık mı?
            </h2>
            <p className="text-slate-600 mt-4 leading-relaxed text-sm md:text-base">
              Çok kanallı reklam veriyor veya yoğun talep alıyorsanız, ekibinizin bu verileri kaybetmesi saniyeler sürer.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Card 1 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white shadow-sm space-y-3">
              <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0 font-bold text-xs">1</div>
              <h3 className="font-bold text-slate-900 text-sm">Formlar Farklı Yerde Kalıyor</h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Web siteniz, Facebook formları veya landing page verileri farklı e-posta kutularına dağılır ve ekipten gözden kaçar.
              </p>
            </div>

            {/* Card 2 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white shadow-sm space-y-3">
              <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0 font-bold text-xs">2</div>
              <h3 className="font-bold text-slate-900 text-sm">WhatsApp Konuşmaları Kayboluyor</h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Personellerin şahıs telefonlarındaki yazışmalar merkezileştirilmediği için takip edilemez ve müşteriye dönülmez.
              </p>
            </div>

            {/* Card 3 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white shadow-sm space-y-3">
              <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0 font-bold text-xs">3</div>
              <h3 className="font-bold text-slate-900 text-sm">Instagram DM'leri Takip Edilemiyor</h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Instagram'dan gelen sıcak mesajlara zamanında yanıt verilemez ve potansiyel fırsatlar rakiplere kayar.
              </p>
            </div>

            {/* Card 4 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white shadow-sm space-y-3">
              <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0 font-bold text-xs">4</div>
              <h3 className="font-bold text-slate-900 text-sm">Kim Aranacak Net Görünmüyor</h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Hangi adayın hangi gün aranacağı, sürecinin ne aşamada olduğu Excel listelerinde veya kâğıtlarda kaybolur.
              </p>
            </div>

            {/* Card 5 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white shadow-sm space-y-3">
              <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0 font-bold text-xs">5</div>
              <h3 className="font-bold text-slate-900 text-sm">Randevu Teyitleri Unutuluyor</h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Klinik veya satış randevularının güncel teyit mesajları zamanında atılmadığı için gelmeyen aday oranı (no-show) yükselir.
              </p>
            </div>

            {/* Card 6 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white shadow-sm space-y-3">
              <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0 font-bold text-xs">6</div>
              <h3 className="font-bold text-slate-900 text-sm">Sıcak Leadlere Geç Dönülüyor</h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Yeni gelen sıcak taleplere ilk 5 dakika içinde dönülmediğinde, adayın satın alma niyeti ve dönüşüm ihtimali %80 azalır.
              </p>
            </div>
          </div>

          <div className="mt-12 text-center bg-blue-50/50 border border-blue-100 rounded-2xl p-6 max-w-4xl mx-auto">
            <p className="text-slate-800 text-[14px] font-bold">
              🚀 Quba AI, tüm bu süreci tek operasyon panelinde toplar ve iletişim otomasyonuyla çözer.
            </p>
          </div>
        </div>
      </section>

      {/* Workflow Section */}
      <section id="workflow" className="bg-white border-t border-slate-200/50 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-20">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-blue-50 border border-blue-100/80 text-[10px] font-bold text-blue-600 mb-3">
              <Workflow className="w-3 h-3 text-blue-600" />
              <span>İş Akış Modeli</span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Lead'den randevuya tek akış
            </h2>
            <p className="text-slate-600 mt-4 leading-relaxed text-sm md:text-base">
              Adayın ilk temas anından klinik randevusunun teyit edilmesine kadar geçen tüm süreçleri otomatik ve denetimli koordine edin.
            </p>
          </div>

          {/* 5-step visual flow */}
          <div className="relative">
            {/* Visual connector line (Desktop only) */}
            <div className="hidden lg:block absolute top-[40px] left-[5%] right-[5%] h-0.5 bg-slate-100 -z-10" />

            <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-8">
              {/* Step 1 */}
              <div className="flex flex-col items-center text-center space-y-4 relative">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg shadow-sm">
                  <Inbox className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-widest">Adım 1</span>
                  <h3 className="font-bold text-slate-900 text-sm mt-1">Lead Gelir</h3>
                  <p className="text-[12px] text-slate-500 leading-relaxed mt-2 max-w-[180px] mx-auto">
                    Form, WhatsApp, Instagram veya Messenger üzerinden gelen talep anında sisteme düşer.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex flex-col items-center text-center space-y-4 relative">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg shadow-sm">
                  <Sparkles className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-widest">Adım 2</span>
                  <h3 className="font-bold text-slate-900 text-sm mt-1">AI Analiz Eder</h3>
                  <p className="text-[12px] text-slate-500 leading-relaxed mt-2 max-w-[180px] mx-auto">
                    Yapay zeka; adayın niyetini, dept/ departmanını, konuşma özetini ve aksiyon planını saniyeler içinde çıkarır.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex flex-col items-center text-center space-y-4 relative">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg shadow-sm">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-widest">Adım 3</span>
                  <h3 className="font-bold text-slate-900 text-sm mt-1">Takip Listesine Düşer</h3>
                  <p className="text-[12px] text-slate-500 leading-relaxed mt-2 max-w-[180px] mx-auto">
                    Hasta veya müşteri adayı, öncelik durumuna göre takip tablosundaki (Pipeline) ilgili aşamaya yerleşir.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex flex-col items-center text-center space-y-4 relative">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg shadow-sm">
                  <Calendar className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-widest">Adım 4</span>
                  <h3 className="font-bold text-slate-900 text-sm mt-1">Randevu Yönetilir</h3>
                  <p className="text-[12px] text-slate-500 leading-relaxed mt-2 max-w-[180px] mx-auto">
                    Telefon görüşmesi, klinik randevusu, teyit, erteleme, geldi/gelmedi akışları tek ekrandan güncellenir.
                  </p>
                </div>
              </div>

              {/* Step 5 */}
              <div className="flex flex-col items-center text-center space-y-4 relative">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg shadow-sm">
                  <Send className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-widest">Adım 5</span>
                  <h3 className="font-bold text-slate-900 text-sm mt-1">Ekip Uyarılır</h3>
                  <p className="text-[12px] text-slate-500 leading-relaxed mt-2 max-w-[180px] mx-auto">
                    Dahili panel ve Telegram bildirimleri sayesinde geciken görevler veya sıcak adaylar anında ekibe iletilir.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Product Modules Section */}
      <section id="modules" className="bg-slate-100/40 border-t border-slate-200/50 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-blue-50 border border-blue-100/80 text-[10px] font-bold text-blue-600 mb-3">
              <Layers className="w-3 h-3 text-blue-600" />
              <span>Ürün Modülleri</span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Güçlü ve Modüler B2B Altyapısı
            </h2>
            <p className="text-slate-600 mt-4 leading-relaxed text-sm md:text-base">
              Müşteri veya hasta ilişkilerinizin her halkasını sıkı sıkıya bağlayan profesyonel operasyon araçları.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Mod 1 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white hover:bg-slate-50/50 transition-all hover:shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                <MessageSquare className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Çok Kanallı Gelen Kutusu</h3>
              <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                WhatsApp, Instagram ve Messenger konuşmalarını ekibinizle ortak yönettiğiniz tek ve merkezileştirilmiş bir ortak gelen kutusu.
              </p>
            </div>

            {/* Mod 2 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white hover:bg-slate-50/50 transition-all hover:shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Form Lead Yönetimi</h3>
              <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                Web sitenizden, Facebook veya Google form reklamlarından gelen lead verilerini tek panelde otomatik kayıt altına alın.
              </p>
            </div>

            {/* Mod 3 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white hover:bg-slate-50/50 transition-all hover:shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">AI Özet ve Fırsat Analizi</h3>
              <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                Konuşmaları özetleyen, departmanı seçen, adayın niyet ve bütçe durumunu otomatik analiz eden yapay zeka entegrasyonu.
              </p>
            </div>

            {/* Mod 4 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white hover:bg-slate-50/50 transition-all hover:shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                <Users className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Hasta / Müşteri Takibi</h3>
              <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                Müşterilerinizi veya hastalarınızı adımlar halinde gruplayabildiğiniz, kimin aranacağını gösteren dinamik takip paneli.
              </p>
            </div>

            {/* Mod 5 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white hover:bg-slate-50/50 transition-all hover:shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                <Calendar className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Randevu Yönetimi</h3>
              <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                Gelen talepler doğrultusunda hızlıca randevu atayabildiğiniz, teyitli ve ertelemeli randevu takvimi modülü.
              </p>
            </div>

            {/* Mod 6 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white hover:bg-slate-50/50 transition-all hover:shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                <Clock className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Teyit ve Hatırlatma Planı</h3>
              <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                Gelmeyen veya teyit bekleyen adaylara yönelik süreç hatırlatmaları hazırlayabileceğiniz kurumsal operasyon alanı.
              </p>
            </div>

            {/* Mod 7 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white hover:bg-slate-50/50 transition-all hover:shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                <Send className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">İç Telegram Bildirimleri</h3>
              <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                Yeni lead düştüğünde, randevu iptal edildiğinde veya teyit alındığında ekibinizi anlık uyaran güvenli iç bildirim botu.
              </p>
            </div>

            {/* Mod 8 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white hover:bg-slate-50/50 transition-all hover:shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Güvenli Taslak ve Onaylı Gönderim</h3>
              <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                AI tarafından hazırlanan şablon taslak yanıtların, insan denetçinin onayından geçtikten sonra iletildiği güvenlik kontrolü.
              </p>
            </div>

            {/* Mod 9 */}
            <div className="p-6 rounded-2xl border border-slate-200/60 bg-white hover:bg-slate-50/50 transition-all hover:shadow-sm">
              <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                <Shield className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Tenant İzolasyonu ve Yetki Yönetimi</h3>
              <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                Her işletmenin veritabanı, verileri ve API anahtarları tamamen izole PostgreSQL odalarında ve güçlü rol yetkilerinde saklanır.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Vertical / Use-Case Section */}
      <section className="bg-white border-t border-slate-200/50 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-blue-50 border border-blue-100/80 text-[10px] font-bold text-blue-600 mb-3">
              <Users className="w-3 h-3 text-blue-600" />
              <span>Sektörel Çözümler</span>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Yüksek lead hacmi olan ekipler için
            </h2>
            <p className="text-slate-600 mt-4 leading-relaxed text-sm md:text-base">
              Farklı sektörlerdeki kurumsal ekiplerin iletişim ve koordinasyonunu tek merkezde optimize edin.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-6">
            {/* Card 1 */}
            <div className="p-5 rounded-xl border border-slate-100 bg-slate-50 flex flex-col justify-between">
              <h4 className="font-bold text-slate-900 text-[13px] leading-tight">Sağlık Turizmi &amp; Hastane Danışman Ekipleri</h4>
              <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">Uluslararası lead akışını, departman ve hekim yönlendirmelerini tek sistem üzerinden koordine edin.</p>
            </div>
            
            {/* Card 2 */}
            <div className="p-5 rounded-xl border border-slate-100 bg-slate-50 flex flex-col justify-between">
              <h4 className="font-bold text-slate-900 text-[13px] leading-tight">Klinikler &amp; Özel Sağlık Kuruluşları</h4>
              <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">Gelen hasta teyit akışlarını, muayene randevularını ve hekim programlarını takip altına alın.</p>
            </div>

            {/* Card 3 */}
            <div className="p-5 rounded-xl border border-slate-100 bg-slate-50 flex flex-col justify-between">
              <h4 className="font-bold text-slate-900 text-[13px] leading-tight">Eğitim Kurumları</h4>
              <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">Öğrenci adaylarının kayıt başvurularını, arama ve görüşme randevularını tek panelde birleştirin.</p>
            </div>

            {/* Card 4 */}
            <div className="p-5 rounded-xl border border-slate-100 bg-slate-50 flex flex-col justify-between">
              <h4 className="font-bold text-slate-900 text-[13px] leading-tight">Ajanslar &amp; Müşteri Destek Ekipleri</h4>
              <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">Müşterilerden gelen tüm sosyal medya ve form taleplerini tek gelen kutusunda paylaştırarak çözün.</p>
            </div>

            {/* Card 5 */}
            <div className="p-5 rounded-xl border border-slate-100 bg-slate-50 flex flex-col justify-between">
              <h4 className="font-bold text-slate-900 text-[13px] leading-tight">Çok Kanallı Satış Ekipleri</h4>
              <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">WhatsApp, Instagram ve e-posta üzerinden ilerleyen B2B/B2C teklif ve sipariş süreçlerini yönetin.</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-100 flex gap-3 text-slate-700 text-[12px] leading-relaxed max-w-4xl mx-auto mt-12">
            <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <p>
              <strong>Sağlık ve Medikal Sınırlar Uyarısı:</strong> Quba AI altyapısı operasyonel iletişim, CRM koordinasyonu ve randevu takip süreçlerini kolaylaştırmak üzere tasarlanmıştır. Platformumuzdaki yapay zeka modülleri <strong>kesinlikle tıbbi teşhis koymaz veya tedavi tavsiyesi vermez</strong>. Tüm nihai kararlar ve son kullanıcı iletişim sorumluluğu işletmeye aittir.
            </p>
          </div>
        </div>
      </section>

      {/* Safety & Compliance Section */}
      <section id="security" className="bg-slate-100/40 border-t border-slate-200/50 py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-[12px] font-bold text-indigo-700 mb-4">
                <Lock className="w-3.5 h-3.5" />
                <span>Güvenlik ve Uyumluluk Altyapısı</span>
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 leading-tight">
                B2B Standartlarında Yüksek Güvenlik Mimarisi
              </h2>
              <p className="text-slate-600 mt-6 leading-relaxed text-sm">
                Quba AI, Meta API politikaları ve KVKK ilkeleri dikkate alınarak tasarlanmış güvenli bir B2B iletişim altyapısı sunar. Verilerinizin izole saklanması ve yetkisiz mesaj çıkışlarının engellenmesi önceliğimizdir.
              </p>

              <div className="space-y-5 mt-8">
                <div className="flex gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Zero-Outbound Güvenlik Modeli</h4>
                    <p className="text-[12px] text-slate-600 mt-1">
                      Quba AI, üretim ortamında izinsiz otomatik WhatsApp mesajı göndermeyecek şekilde güvenli tasarlanmıştır. AI mesaj taslağı hazırlar; gönderim işletme onayı ve kanal kurallarına bağlıdır.
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Meta Business API Entegrasyon Altyapısı</h4>
                    <p className="text-[12px] text-slate-600 mt-1">
                      Platform, resmi Meta Business API entegrasyonlarına uygun çalışacak şekilde tasarlanmıştır. Kanal bağlantıları, ilgili işletmenin Meta onay ve yetkilendirme süreçlerine tabidir.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">İzole Yetki Kontrolü</h4>
                    <p className="text-[12px] text-slate-600 mt-1">
                      İşletmenizin personellerine yönelik gelişmiş rol tabanlı yetki sınırlandırması sayesinde veri sızıntılarını ve operasyon yetki aşımını engelleyin.
                    </p>
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
                  <h4 className="font-bold text-slate-900">Güvenlik ve Yetki Taahhüdü</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">Yetki kontrollü ve tenant izolasyonlu güvenli bulut altyapısı</p>
                </div>
              </div>

              <p className="text-[13px] text-slate-600 leading-relaxed">
                Quba AI altyapısında barındırılan tüm müşteri konuşmaları, form verileri ve randevu kayıtları en üst düzey yetki ve tenant izolasyonu ile ayrılmıştır. PostgreSQL veritabanı odaları her üye işletme için izole edilmiş olup, veri sızıntısı ihtimali mimari düzeyde engellenmiştir. Sistem üzerindeki AI asistanı sadece destekleyici taslaklar üretmekte olup yasal veri işleme rızaları işletmenin taahhüdündedir.
              </p>

              <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-semibold">
                <span>Altyapı: Vercel &amp; Neon</span>
                <span>KVKK Duyarlı Tasarım</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Proof / Trust Section */}
      <section className="bg-white border-t border-slate-200/50 py-20">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <div className="max-w-3xl mx-auto mb-12">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
              Operasyon için tasarlanmış güvenli mimari
            </h2>
            <p className="text-slate-500 mt-3 text-xs md:text-sm">
              Sistemimizin mimari ve fonksiyonel olarak kararlı kalmasını sağlayan güven noktaları.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-6 text-slate-700 font-semibold text-xs">
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 shadow-sm flex flex-col items-center justify-center space-y-2">
              <Shield className="w-5 h-5 text-blue-600" />
              <span>Tenant İzolasyonu</span>
            </div>
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 shadow-sm flex flex-col items-center justify-center space-y-2">
              <Users className="w-5 h-5 text-blue-600" />
              <span>Rol/Yetki Kontrolü</span>
            </div>
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 shadow-sm flex flex-col items-center justify-center space-y-2">
              <Inbox className="w-5 h-5 text-blue-600" />
              <span>İç Bildirim &amp; Audit Log</span>
            </div>
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 shadow-sm flex flex-col items-center justify-center space-y-2">
              <CheckCircle2 className="w-5 h-5 text-blue-600" />
              <span>Taslak/Onay Mekanizması</span>
            </div>
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 shadow-sm flex flex-col items-center justify-center space-y-2">
              <Trash2 className="w-5 h-5 text-blue-600" />
              <span>Veri Silme ve Destek</span>
            </div>
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 shadow-sm flex flex-col items-center justify-center space-y-2">
              <Check className="w-5 h-5 text-blue-600" />
              <span>Meta Uyumlu Altyapı</span>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="bg-slate-100/40 border-t border-slate-200/50 py-24">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">Sıkça Sorulan Sorular</h2>
            <p className="text-slate-600 mt-4">Platformun özellikleri ve uyumluluk konularında merak edilenler.</p>
          </div>

          <div className="space-y-6">
            {/* Question 1 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm">
              <h4 className="font-bold text-slate-900 text-sm flex gap-3 items-center">
                <HelpCircle className="w-5 h-5 text-blue-600 shrink-0" />
                1. Quba AI hangi işletmeler için uygundur?
              </h4>
              <p className="text-[13px] text-slate-600 mt-3 pl-8 leading-relaxed">
                Gelen WhatsApp, Instagram, Messenger mesajları ve web site/reklam form hacmi yüksek olan; lead takibinde gecikmeler yaşayan klinikler, sağlık turizmi acenteleri, eğitim kurumları ve çok kanallı satış/destek ekipleri için idealdir.
              </p>
            </div>

            {/* Question 2 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm">
              <h4 className="font-bold text-slate-900 text-sm flex gap-3 items-center">
                <HelpCircle className="w-5 h-5 text-blue-600 shrink-0" />
                2. WhatsApp ve Instagram mesajlarını otomatik mi yanıtlar?
              </h4>
              <p className="text-[13px] text-slate-600 mt-3 pl-8 leading-relaxed">
                Quba AI, zero-outbound prensibine sahiptir. Yapay zeka gelen mesajlara otomatik olarak dışarıya bağımsız mesaj atamaz. Bunun yerine en uygun yanıt taslağını (Draft) hazırlar ve ekibinizin onayına sunar. Personel onay vermeden dışarıya mesaj gitmez.
              </p>
            </div>

            {/* Question 3 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm">
              <h4 className="font-bold text-slate-900 text-sm flex gap-3 items-center">
                <HelpCircle className="w-5 h-5 text-blue-600 shrink-0" />
                3. AI hastalara tıbbi tavsiye verir mi?
              </h4>
              <p className="text-[13px] text-slate-600 mt-3 pl-8 leading-relaxed">
                Hayır. Yapay zeka modüllerimiz sadece operasyonel ve asistanlık amaçlı bilgi ve özet üretir. Kesinlikle tıbbi teşhis koyma, tanı yapma veya hekim adına tedavi tavsiyesi verme yetkisi veya fonksiyonu yoktur.
              </p>
            </div>

            {/* Question 4 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm">
              <h4 className="font-bold text-slate-900 text-sm flex gap-3 items-center">
                <HelpCircle className="w-5 h-5 text-blue-600 shrink-0" />
                4. Randevu yönetimi nasıl çalışır?
              </h4>
              <p className="text-[13px] text-slate-600 mt-3 pl-8 leading-relaxed">
                Sistem entegre bir randevu takvimine sahiptir. Ekipleriniz gelen adaylar için takvimi planlayabilir, erteleyebilir ve randevu teyitlerini panel üzerindeki ilgili WhatsApp veya diğer kanallara yönelik taslaklar aracılığıyla takip edebilir.
              </p>
            </div>

            {/* Question 5 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm">
              <h4 className="font-bold text-slate-900 text-sm flex gap-3 items-center">
                <HelpCircle className="w-5 h-5 text-blue-600 shrink-0" />
                5. Form leadleri sisteme düşer mi?
              </h4>
              <p className="text-[13px] text-slate-600 mt-3 pl-8 leading-relaxed">
                Evet. Web sitelerinizden, landing pagelerden veya Facebook form reklam kampanyalarından gelen tüm başvuru leadleri, webhook ve asenkron kuyruk modülleriyle anında sisteme kaydedilir ve takibe alınır.
              </p>
            </div>

            {/* Question 6 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm">
              <h4 className="font-bold text-slate-900 text-sm flex gap-3 items-center">
                <HelpCircle className="w-5 h-5 text-blue-600 shrink-0" />
                6. Meta onayı olmadan sistem çalışır mı?
              </h4>
              <p className="text-[13px] text-slate-600 mt-3 pl-8 leading-relaxed">
                Sohbet kanallarının aktifleşmesi için resmi Meta Business Manager tescili ve ilgili API izinlerinin alınması gerekir. Bu tescil ve entegrasyon süreçlerinde teknik ekibimiz firmanıza ücretsiz kurulum danışmanlığı sağlamaktadır.
              </p>
            </div>

            {/* Question 7 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm">
              <h4 className="font-bold text-slate-900 text-sm flex gap-3 items-center">
                <HelpCircle className="w-5 h-5 text-blue-600 shrink-0" />
                7. Veriler nerede saklanır?
              </h4>
              <p className="text-[13px] text-slate-600 mt-3 pl-8 leading-relaxed">
                Verileriniz Vercel ve şifreli Neon bulut sunucularında, her işletme (Tenant) için tamamen izole edilmiş veri tabanı odalarında güvenle saklanır. Her tenant'ın verisi mimari olarak diğerinden izoledir.
              </p>
            </div>

            {/* Question 8 */}
            <div className="bg-white p-6 rounded-xl border border-slate-200/60 shadow-sm">
              <h4 className="font-bold text-slate-900 text-sm flex gap-3 items-center">
                <HelpCircle className="w-5 h-5 text-blue-600 shrink-0" />
                8. Veri silme talebi nasıl yapılır?
              </h4>
              <p className="text-[13px] text-slate-600 mt-3 pl-8 leading-relaxed">
                Verilerinizin sistemlerimizden tamamen temizlenmesini talep etmek için `/data-deletion` sayfamızda yer alan Facebook uygulama kaldırma ve e-posta ile başvuru talimatlarını izleyebilirsiniz.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Footer Section */}
      <section className="bg-gradient-to-br from-slate-900 to-slate-950 text-white py-20 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Ekibinizin lead ve randevu takibini tek panelde toplayalım.</h2>
          <p className="text-slate-400 mt-4 max-w-2xl mx-auto text-sm md:text-base leading-relaxed">
            Quba AI demosu için bize ulaşın; mevcut form, WhatsApp ve Instagram akışınıza göre size özel kurulum planı çıkaralım.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a 
              href="mailto:mercan@qubamedya.com?subject=Quba AI Demo Talebi"
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md transition-all active:scale-95"
            >
              Demo Talep Et
            </a>
            <Link 
              href="/login" 
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold transition-all"
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
            <img src="/quba-logo.svg" alt="Quba AI Logo" className="w-6 h-6 object-contain" />
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
            <p className="mt-1">Quba AI, bir Quba Medya markasıdır.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
