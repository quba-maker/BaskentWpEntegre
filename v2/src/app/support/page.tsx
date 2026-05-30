import Link from "next/link";
import { Bot, ArrowLeft, LifeBuoy, Mail, Sparkles, AlertCircle, FileText, Trash2, KeyRound, Check } from "lucide-react";

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-500 selection:text-white font-sans">
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
              <LifeBuoy className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">Destek &amp; İletişim</h1>
              <p className="text-xs text-slate-500 mt-1">Quba AI Müşteri Yardım ve Entegrasyon Destek Masası</p>
            </div>
          </div>

          <p className="text-[14px] text-slate-600 leading-relaxed mb-10">
            Quba AI platformunu kullanırken karşılaştığınız teknik sorunlar, yeni kanal entegrasyon talepleri veya demo başvurularınız için bizimle doğrudan iletişime geçebilirsiniz. Destek ekibimiz en kısa sürede taleplerinizi yanıtlandıracaktır.
          </p>

          {/* Support Channels Grid */}
          <div className="grid md:grid-cols-2 gap-6 mb-10">
            {/* Box 1: Support Email */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all hover:shadow-sm flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                  <Mail className="w-4.5 h-4.5" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">Resmi Destek Kanalı</h3>
                <p className="text-[12px] text-slate-500 mt-1.5 leading-relaxed">
                  Sistem arızaları, şifre sıfırlama, API hataları veya genel sorularınız için bize yazın.
                </p>
              </div>
              <a 
                href="mailto:mercan@qubamedya.com?subject=Quba AI Teknik Destek Talebi"
                className="mt-6 inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors shadow-sm"
              >
                <span>Destek E-postası Gönder</span>
              </a>
            </div>

            {/* Box 2: Demo Request */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all hover:shadow-sm flex flex-col justify-between">
              <div>
                <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center mb-4">
                  <Sparkles className="w-4.5 h-4.5" />
                </div>
                <h3 className="font-bold text-slate-900 text-sm">Demo &amp; Satış Talebi</h3>
                <p className="text-[12px] text-slate-500 mt-1.5 leading-relaxed">
                  İşletmeniz için özel tenant kurulumu yaptırmak, fiyat listelerimizi öğrenmek veya sunum istemek için.
                </p>
              </div>
              <a 
                href="mailto:mercan@qubamedya.com?subject=Quba AI Satış / Demo Talebi"
                className="mt-6 inline-flex items-center justify-center gap-2 w-full py-2.5 border border-slate-200 hover:bg-slate-100 text-slate-800 font-semibold text-xs transition-colors"
              >
                <span>Demo / Satış İletişimi</span>
              </a>
            </div>
          </div>

          {/* Quick Legal & Utility Links */}
          <div className="border border-slate-100 rounded-2xl p-6 bg-slate-50/30 mb-10">
            <h4 className="font-bold text-slate-900 text-xs tracking-wider uppercase mb-4">Hızlı Yönlendirmeler</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-semibold text-slate-600">
              <Link href="/privacy" className="flex items-center gap-2 hover:text-blue-600 transition-colors p-2 bg-white rounded-lg border border-slate-100 shadow-sm">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>Gizlilik</span>
              </Link>
              <Link href="/terms" className="flex items-center gap-2 hover:text-blue-600 transition-colors p-2 bg-white rounded-lg border border-slate-100 shadow-sm">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>Kullanım Koşulları</span>
              </Link>
              <Link href="/data-deletion" className="flex items-center gap-2 hover:text-blue-600 transition-colors p-2 bg-white rounded-lg border border-slate-100 shadow-sm text-red-600">
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                <span>Veri Silme</span>
              </Link>
              <Link href="/legal" className="flex items-center gap-2 hover:text-blue-600 transition-colors p-2 bg-white rounded-lg border border-slate-100 shadow-sm">
                <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                <span>Yasal Bilgiler</span>
              </Link>
            </div>
          </div>

          {/* Meta & WhatsApp Integration Instructions */}
          <div className="space-y-4 border-t border-slate-100 pt-8">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-blue-600 shrink-0" />
              Meta / WhatsApp Business Entegrasyon Desteği
            </h3>
            
            <p className="text-[13px] text-slate-600 leading-relaxed">
              Quba AI B2B sistemine kendi Meta Business Portalinizi entegre etmek için bazı yasal adımlar gereklidir. Bu süreci destek ekibimizle birlikte koordine edebilirsiniz:
            </p>

            <div className="space-y-3 mt-4 text-[13px] text-slate-600 pl-4 border-l-2 border-slate-100">
              <p>
                <strong>1. Meta Business Suite Doğrulaması:</strong> WhatsApp Business API ve Instagram Messenger API kullanabilmeniz için firmanızın Meta Business Manager üzerinde tescilli, yasal bir işletme olarak doğrulanmış olması (Business Verification) şarttır.
              </p>
              <p>
                <strong>2. API Yetkilendirme / Token Kurulumu:</strong> Firmanıza ait resmi API anahtarları, Quba AI ekibi tarafından sisteminizdeki izole veritabanı odanıza (Tenant Database) şifrelenmiş olarak tanımlanır. Yetkisiz kimse erişemez.
              </p>
              <p>
                <strong>3. Destek İrtibatı:</strong> Kurulum, webhook bağlama ve Meta onay süreçlerinde destek ekibimiz firmanıza ücretsiz entegrasyon danışmanlığı sağlamaktadır. Lütfen <strong>mercan@qubamedya.com</strong> adresi üzerinden kurulum planlaması randevusu talep edin.
              </p>
            </div>
          </div>
        </div>

        {/* Footer info inside main */}
        <div className="mt-8 text-center text-xs text-slate-500">
          <p>© 2026 Quba AI. Tüm hakları saklıdır. Quba AI, bir Quba Medya markasıdır.</p>
        </div>
      </main>
    </div>
  );
}
