import Link from "next/link";
import { Bot, ArrowLeft, Building2, Globe, Mail, Phone, MapPin, Hash, Check } from "lucide-react";

export default function LegalPage() {
  // Organization JSON-LD Structured Data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Quba Medya",
    "taxID": "3410314137",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Hacıkaymak Mah. Hatım Sk. B Blok No: 4 İç Kapı No: 18",
      "addressLocality": "Selçuklu",
      "addressRegion": "Konya",
      "postalCode": "42000",
      "addressCountry": "TR"
    },
    "telephone": "+905546833306",
    "email": "mercan@qubamedya.com",
    "url": "https://www.qubamedya.com"
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-500 selection:text-white font-sans">
      {/* JSON-LD injection */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Mini Header */}
      <header className="sticky top-0 z-40 bg-white/70 backdrop-blur-md border-b border-slate-200/50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group text-slate-600 hover:text-slate-900 transition-colors">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            <span className="text-sm font-semibold">Ana Sayfaya Dön</span>
          </Link>
          
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold tracking-tight text-slate-900">Quba AI</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-4xl mx-auto px-6 py-12 md:py-16">
        <div className="bg-white border border-slate-200/60 rounded-3xl p-8 md:p-12 shadow-sm">
          {/* Header Info */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">Yasal Bilgiler</h1>
              <p className="text-xs text-slate-500 mt-1">Quba AI — Kurumsal Künye ve İşletme Bilgileri</p>
            </div>
          </div>

          <p className="text-[14px] text-slate-600 leading-relaxed mb-8">
            Aşağıda, Quba AI platformunun yasal sağlayıcısı olan Quba Medya markasına ait resmi künye, iletişim ve tescilli işletme verileri yer almaktadır. Platformumuz üzerinden sunulan tüm hizmetler Türkiye Cumhuriyeti yasalarına tabidir.
          </p>

          {/* Legal Details Grid/Table */}
          <div className="border border-slate-100 rounded-2xl overflow-hidden bg-slate-50/50 mb-10">
            <table className="w-full text-left text-[13px] border-collapse">
              <tbody>
                <tr className="border-b border-slate-100/80">
                  <td className="p-4 font-bold text-slate-900 bg-slate-100/30 flex items-center gap-2">
                    <Bot className="w-4 h-4 text-slate-400" />
                    Tescilli Marka / Ürün
                  </td>
                  <td className="p-4 text-slate-700 font-medium">Quba Medya / Quba AI</td>
                </tr>
                <tr className="border-b border-slate-100/80">
                  <td className="p-4 font-bold text-slate-900 bg-slate-100/30 flex items-center gap-2">
                    <Hash className="w-4 h-4 text-slate-400" />
                    Vergi Dairesi
                  </td>
                  <td className="p-4 text-slate-700 font-medium">Meram</td>
                </tr>
                <tr className="border-b border-slate-100/80">
                  <td className="p-4 font-bold text-slate-900 bg-slate-100/30 flex items-center gap-2">
                    <Hash className="w-4 h-4 text-slate-400" />
                    Vergi Kimlik Numarası (VKN)
                  </td>
                  <td className="p-4 text-slate-700 font-bold text-blue-600">3410314137</td>
                </tr>
                <tr className="border-b border-slate-100/80">
                  <td className="p-4 font-bold text-slate-900 bg-slate-100/30 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-slate-400" />
                    Resmi Adres
                  </td>
                  <td className="p-4 text-slate-700 leading-relaxed">
                    Hacıkaymak Mah. Hatım Sk. B Blok No: 4 İç Kapı No: 18, Selçuklu / Konya 42000, Türkiye
                  </td>
                </tr>
                <tr className="border-b border-slate-100/80">
                  <td className="p-4 font-bold text-slate-900 bg-slate-100/30 flex items-center gap-2">
                    <Phone className="w-4 h-4 text-slate-400" />
                    Resmi İrtibat Telefonu
                  </td>
                  <td className="p-4 text-slate-700 font-medium">+90 554 683 33 06</td>
                </tr>
                <tr className="border-b border-slate-100/80">
                  <td className="p-4 font-bold text-slate-900 bg-slate-100/30 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-slate-400" />
                    İrtibat E-postası
                  </td>
                  <td className="p-4 text-slate-700 font-medium text-blue-600">
                    <a href="mailto:mercan@qubamedya.com" className="hover:underline">mercan@qubamedya.com</a>
                  </td>
                </tr>
                <tr className="border-b border-slate-100/80">
                  <td className="p-4 font-bold text-slate-900 bg-slate-100/30 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-slate-400" />
                    Resmi Web Siteleri
                  </td>
                  <td className="p-4 text-slate-700 space-y-1">
                    <div>
                      <span className="text-xs text-slate-400 mr-2">Ajans Portalı:</span>
                      <a href="https://www.qubamedya.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-semibold">https://www.qubamedya.com</a>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 mr-2">Ürün Portalı:</span>
                      <a href="https://ai.qubamedya.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-semibold">https://ai.qubamedya.com</a>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Secure Trust Alert */}
          <div className="p-5 rounded-2xl bg-emerald-50/50 border border-emerald-100/80 text-slate-700 text-[13px] leading-relaxed">
            <h4 className="font-bold text-emerald-900 text-sm mb-1.5 flex items-center gap-2">
              <Check className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
              Yasal Güvenlik ve Uyum Standardı
            </h4>
            <p className="text-slate-600">
              Quba AI altyapısında barındırılan kurumsal B2B entegrasyonlar, ilgili Meta sözleşmeleri ve yerel vergi yasalarına tam uyumlu olarak faturalandırılmaktadır. Sisteme girilen tüm yasal bilgiler en üst düzeyde korunmaktadır. T.C. kimlik numaraları, veri güvenliği standartlarımız uyarınca hiçbir dijital arayüzde veya faturada açıkça gösterilmemektedir.
            </p>
          </div>
        </div>

        {/* Footer info inside main */}
        <div className="mt-8 text-center text-xs text-slate-500">
          <p>© 2026 Quba AI. Tüm hakları saklıdır. Quba AI, Quba Medya markası altında sunulur.</p>
        </div>
      </main>
    </div>
  );
}
