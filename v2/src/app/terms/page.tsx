import Link from "next/link";
import { Bot, ArrowLeft, FileText, Lock, Info } from "lucide-react";

export default function TermsPage() {
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
            <img src="/quba-logo.svg" alt="Quba AI Logo" className="w-7 h-7 object-contain" />
            <span className="text-sm font-bold tracking-tight text-slate-900">Quba AI</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-4xl mx-auto px-6 py-12 md:py-16">
        <div className="bg-white border border-slate-200/60 rounded-3xl p-8 md:p-12 shadow-sm">
          {/* Header Info */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">Kullanım Koşulları</h1>
              <p className="text-xs text-slate-500 mt-1">Son güncelleme: 30 Mayıs 2026</p>
            </div>
          </div>

          {/* Legal Bind Alert */}
          <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-100 flex gap-3 text-slate-700 text-[13px] leading-relaxed mb-10">
            <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <p>
              <strong>Yasal Bilgilendirme:</strong> Quba AI, Quba Medya markası altında sunulan B2B SaaS (Software-as-a-Service) platformudur. Bu platformu kullanan işletmeler (Tenant), aşağıda belirtilen kullanım şartlarına uymayı taahhüt eder.
            </p>
          </div>

          {/* Detailed Content */}
          <div className="space-y-10 text-[14px] leading-relaxed text-slate-700">
            {/* Section 1 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                1. B2B Hizmet Tanımı ve Kapsamı
              </h2>
              <p>
                Quba AI; üye işletmelerin (Tenant) müşterileri ve potansiyel adayları ile olan mesajlaşmalarını, Meta Business API entegrasyonları aracılığıyla tek panelden takip etmelerini sağlayan bulut tabanlı bir iş uygulamasıdır. Hizmet kapsamında yapay zeka ile diyalog özetleme, randevu kaydı oluşturma ve müşteri niyet analizi gibi operasyon kolaylaştırıcı modüller yer almaktadır.
              </p>
            </section>

            {/* Section 2 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                2. Kullanıcı Sorumlulukları ve Tenant Yetkileri
              </h2>
              <p>
                Quba AI panelini kullanan işletmeler (Tenant), panel kullanıcılarının şifre ve erişim güvenliğinden bizzat sorumludur. İşletme, platformda tanımladığı personellerinin yetki sınırlarını tayin etmek ve yetkisiz veri indirmelerini/görüntülemelerini denetlemekle yükümlüdür. Personel hatalarından veya zayıf şifre tercihlerinden kaynaklı veri sızıntılarından Quba Medya sorumlu tutulamaz.
              </p>
            </section>

            {/* Section 3 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                3. Meta Platform Politikalarına Uyum Taahhüdü
              </h2>
              <p>
                İşletme, sisteme entegre ettiği WhatsApp Business, Instagram Professional ve Messenger hesaplarının kullanımında, Meta Platforms Inc. tarafından yayınlanan tüm kullanım koşullarına ve &quot;Meta Business SDK&quot; politikalarına eksiksiz uyacağını kabul ve taahhüt eder. API bağlantılarının Meta kuralları dışına çıkılarak suistimal edilmesi durumunda doğacak yaptırımlar tamamen işletmenin sorumluluğundadır.
              </p>
            </section>

            {/* Section 4 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                4. Spam ve İzinsiz / Toplu Mesajlaşma Yasağı
              </h2>
              <p>
                Platformumuz aracılığıyla, kişilerin açık rızası olmadan reklam, kampanya ve tanıtım amaçlı <strong>istenmeyen toplu mesaj (Spam)</strong> gönderilmesi kesinlikle yasaktır. Quba AI üzerinde sadece son kullanıcının başlattığı aktif konuşmalara veya onaylı şablon mesajlarla (Template Messages) yasal sınırlarda yapılan bildirimlere izin verilir. Bu kuralın ihlali durumunda hizmet tek taraflı askıya alınacaktır.
              </p>
            </section>

            {/* Section 5 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                5. Yapay Zeka (AI) Kullanım Sınırları
              </h2>
              <p>
                Quba AI içerisinde sunulan yapay zeka modelleri (Google Gemini API altyapısı), sadece ekiplerin gelen konuşmaları özetlemesine, bilgi taslakları (Draft) hazırlamasına yardımcı olmak amacıyla geliştirilmiştir. AI modüllerinin yasal ve etik sınırlar dışında manipüle edilmesi veya otomatik yanıtlama sistemlerinin denetimsiz bırakılması yasaktır.
              </p>
            </section>

            {/* Section 6 */}
            <section className="space-y-3 p-5 rounded-2xl bg-amber-50/50 border border-amber-100/80">
              <h2 className="text-base font-bold text-amber-900 flex items-center gap-2">
                ⚠️ Sağlık / Medikal İçerik Uyarısı ve Teşhis Sınırları
              </h2>
              <p className="text-[13px] text-amber-950/80 leading-relaxed mt-1">
                Sistemi kullanan işletmenin sağlık kuruluşu veya klinik olması durumunda: Quba AI platformu üzerindeki yapay zeka modülleri <strong>kesinlikle tıbbi teşhis, tanı koyma, tedavi önerme veya klinik yönlendirme yapmaz ve bu amaçla kullanılamaz</strong>. AI tarafından sunulan tüm içerikler tamamen operasyonel/destekleyici iletişim taslaklarıdır ve hiçbir koşulda medikal veya profesyonel hekim tavsiyesi niteliği taşımaz.
              </p>
            </section>

            {/* Section 7 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                6. İşletmenin Denetim ve Nihai Onay Sorumluluğu
              </h2>
              <p>
                Platform üzerindeki &quot;Zero-Outbound&quot; güvenlik modelimiz gereği, yapay zekanın kendi başına dışarıya bağımsız mesaj gönderme yetkisi bulunmamaktadır. AI asistanının ürettiği tüm taslak mesajlar, <strong>gönderilmeden önce işletmenin yetkili personeli tarafından okunmalı, doğrulanmalı ve manuel onay verilerek gönderilmelidir</strong>. Nihai mesaj içeriğinden ve son kullanıcıya iletilen bilgilerden tamamen işletme sorumludur.
              </p>
            </section>

            {/* Section 8 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                7. Veri Güvenliği ve KVKK Taahhüdü
              </h2>
              <p>
                Quba AI, verilerin barındırılmasında yüksek güvenlik standartlarına ve tenant bazlı izole mimariye (Neon isolated databases) önem verir. Ancak sisteme kaydedilen son kullanıcı veya hasta verilerinin işlenmesi için gerekli KVKK rıza metinlerinin ve yasal onayların (açık rıza beyanlarının) alınması sorumluluğu tamamen platformu kullanan üye işletmeye (Tenant) aittir.
              </p>
            </section>

            {/* Section 9 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                8. Hizmet Sınırlamaları ve Kesintiler
              </h2>
              <p>
                Platformumuz Meta API servisleri, bulut altyapı sağlayıcıları (Vercel, Neon, Google Gemini) ve internet erişim protokollerine bağımlı olarak çalışmaktadır. Bu sağlayıcıların küresel kesintilerinden, Meta API versiyon değişikliklerinden veya planlı sunucu bakımlarından kaynaklanabilecek geçici aksaklıklardan dolayı Quba Medya doğrudan sorumlu tutulamaz.
              </p>
            </section>

            {/* Section 10 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                9. Hizmetin Askıya Alınması ve Fesih
              </h2>
              <p>
                Spam gönderimi yapıldığı, hastaların veya son kullanıcıların verilerinin yasa dışı yollarla işlendiği, kötü niyetli API suistimali veya fatura ödeme yükümlülüklerinin yerine getirilmediği durumlarda Quba Medya, ilgili tenant hesabını ve tüm API bağlantılarını önceden bildirimde bulunmaksızın askıya alma ve sözleşmeyi tek taraflı feshetme hakkına sahiptir.
              </p>
            </section>

            {/* Section 11 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                10. Sorumluluk Sınırları
              </h2>
              <p>
                Quba Medya, platformun kullanımı neticesinde işletmenin elde ettiği ciro, hasta rasyosu veya iş başarısı gibi ticari sonuçlara dair hiçbir taahhütte bulunmaz. Dolaylı zararlardan, veri kayıplarından veya işletme içi koordinasyon aksaklıklarından kaynaklanan maddi/manevi zararlardan dolayı Quba Medya'nın yasal sorumluluğu bulunmamaktadır.
              </p>
            </section>

            {/* Section 12 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                11. İletişim
              </h2>
              <p>
                Hizmet şartlarımız ve yasal sınırlandırmalarla ilgili tüm soru ve önerileriniz için bizimle yazılı olarak <strong>mercan@qubamedya.com</strong> adresi üzerinden irtibata geçebilirsiniz.
              </p>
            </section>
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
