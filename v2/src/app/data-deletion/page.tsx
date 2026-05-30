import Link from "next/link";
import { Bot, ArrowLeft, Trash2, Mail, Link2, ShieldAlert, CheckCircle2 } from "lucide-react";

export default function DataDeletionPage() {
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
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">Veri Silme Talimatları</h1>
              <p className="text-xs text-slate-500 mt-1">Meta App &amp; KVKK Uyumlu Kaldırma Kılavuzu</p>
            </div>
          </div>

          <p className="text-[14px] text-slate-600 leading-relaxed mb-8">
            Quba AI, Meta Platforms (Facebook, Instagram, WhatsApp) entegrasyonlarına sahip bir B2B platformudur. Kullanıcılarımızın ve platformumuz aracılığıyla iletişim kuran son kullanıcıların veri gizliliğini korumak önceliğimizdir. Aşağıdaki adımları takip ederek platformumuzla olan bağlantınızı kesebilir ve verilerinizin silinmesini talep edebilirsiniz.
          </p>

          {/* Detailed Steps */}
          <div className="space-y-8 text-[14px] leading-relaxed text-slate-700">
            {/* Box: Who can request */}
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/60">
              <h3 className="font-bold text-slate-900 text-sm mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-4.5 h-4.5 text-blue-600 shrink-0" />
                Kimler Veri Silme Talebinde Bulunabilir?
              </h3>
              <p className="text-[13px] text-slate-600">
                Quba AI paneline kayıtlı kurumsal işletmeler (Tenant), panel kullanıcıları ve bu işletmelerin WhatsApp/Instagram/Messenger üzerinden iletişim kurduğu son müşteriler veya hastalar, kendileriyle ilişkili kişisel verilerin silinmesini her zaman talep edebilirler.
              </p>
            </div>

            {/* Step 1 */}
            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                Yöntem: E-posta ile Silme Talebi Gönderme
              </h2>
              <p>
                Kişisel verilerinizin sistemlerimizden tamamen temizlenmesi için, aşağıda listelenen resmi iletişim e-posta adreslerimize yazılı bir talep göndermeniz yeterlidir:
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mt-2">
                <a 
                  href="mailto:mercan@qubamedya.com?subject=Quba AI Veri Silme Talebi"
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-800 transition-colors shrink-0"
                >
                  <Mail className="w-4 h-4 text-slate-500" />
                  <span className="font-semibold text-xs">mercan@qubamedya.com</span>
                </a>
                <a 
                  href="mailto:info@qubamedya.com?subject=Quba AI Veri Silme Talebi"
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-800 transition-colors shrink-0"
                >
                  <Mail className="w-4 h-4 text-slate-500" />
                  <span className="font-semibold text-xs">info@qubamedya.com</span>
                </a>
              </div>
            </section>

            {/* Step 2 */}
            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                Talebinizde Yer Alması Gereken Bilgiler
              </h2>
              <p>
                Talebinizin hızlıca işlenebilmesi için e-postanızda lütfen aşağıdaki bilgileri belirtiniz:
              </p>
              <ul className="list-disc pl-6 space-y-1 text-slate-600">
                <li>Sistemde kayıtlı kurumsal adınız veya işletme unvanınız (Tenant adınız),</li>
                <li>İlişkilendirilmiş e-posta adresiniz veya son kullanıcı iseniz mesajlaştığınız telefon numaranız,</li>
                <li>Hangi Meta kanallarına ait geçmişin silinmesini istediğiniz (örneğin sadece WhatsApp veya tüm hesap geçmişi).</li>
              </ul>
            </section>

            {/* Step 3 */}
            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                Facebook / Meta Uygulama Bağlantısını Kaldırma Adımları
              </h2>
              <p>
                Quba AI platformunun Facebook/Meta hesabınıza olan doğrudan erişimini kaldırmak için Meta App Dashboard üzerinden aşağıdaki adımları gerçekleştirebilirsiniz:
              </p>
              <ol className="list-decimal pl-6 space-y-2 text-slate-600">
                <li>Kendi Facebook hesabınızda <strong>Ayarlar ve Gizlilik &gt; Ayarlar</strong> bölümüne gidin.</li>
                <li>Sol menüde yer alan <strong>Uygulamalar ve Web Siteleri</strong> (Apps and Websites) seçeneğine tıklayın.</li>
                <li>Listeden <strong>Quba AI</strong> uygulamasını bulun.</li>
                <li>Uygulamanın yanındaki <strong>Kaldır</strong> (Remove) butonuna tıklayarak Meta iznini tek taraflı iptal edin.</li>
              </ol>
            </section>

            {/* Section 4 */}
            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">4</span>
                Tenant Verisi ve Son Kullanıcı Verisi Ayrımı
              </h2>
              <p>
                Veri silme işlemlerinde sistemimiz iki temel akışa sahiptir:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 text-slate-600">
                <li><strong>Kurumsal Tenant Verileri:</strong> İşletmenin platform üyeliği sona erdiğinde veya silme talebi yapıldığında, o işletmeye ait tüm veri tabanı tabloları, şifreli API anahtarları, sohbet geçmişleri ve logları geri döndürülemeyecek şekilde veritabanından tamamen kazınır (Hard Delete).</li>
                <li><strong>Son Kullanıcı Verileri:</strong> Bir son kullanıcının (hasta veya müşteri) başvurusu üzerine, sadece o kişiye ait telefon numarası, isim ve mesaj geçmişleri ilgili işletmenin panelinden silinir veya anonim hale getirilir.</li>
              </ul>
            </section>

            {/* Section 5 */}
            <section className="space-y-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">5</span>
                Talebin İncelenme Süreci ve Süreler
              </h2>
              <p>
                İletişim adreslerimize ulaşan veri silme talepleri, teknik ekibimiz tarafından derhal güvenlik ve kimlik doğrulama kontrollerinden geçirilir. Onaylanan talepler, KVKK ve yasal mevzuata uygun olarak <strong>en geç 30 (otuz) gün içerisinde</strong> veri tabanlarımızdan tamamen silinir veya geri döndürülemeyecek şekilde anonimleştirilir. İşlem tamamlandığında tarafınıza yazılı bilgi verilir.
              </p>
            </section>

            {/* Warning box */}
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 flex gap-3 text-slate-700 text-[13px] leading-relaxed">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p>
                <strong>Yasal Saklama Yükümlülüğü Açıklaması:</strong> İşletmemiz, 213 sayılı Vergi Usul Kanunu ve ilgili mali mevzuat gereğince fatura, ticari sözleşme ve belirli resmi logları yasal saklama süreleri (genellikle 5 ile 10 yıl arasında) boyunca saklamakla yükümlüdür. Bu yasal yükümlülük kapsamı dışındaki tüm sohbet ve CRM verileriniz talebiniz doğrultusunda derhal silinir.
              </p>
            </div>
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
