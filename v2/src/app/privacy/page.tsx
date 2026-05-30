import Link from "next/link";
import { Bot, ArrowLeft, Shield, Lock, Info, Mail } from "lucide-react";

export default function PrivacyPage() {
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
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">Gizlilik Politikası</h1>
              <p className="text-xs text-slate-500 mt-1">Son güncelleme: 30 Mayıs 2026</p>
            </div>
          </div>

          {/* Legal Bind Alert */}
          <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-100 flex gap-3 text-slate-700 text-[13px] leading-relaxed mb-10">
            <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <p>
              <strong>Yasal Bilgilendirme:</strong> Quba AI, Quba Medya markası altında geliştirilen B2B yapay zeka iletişim ve CRM platformudur. Bu politika kapsamında veri sorumlusu sıfatı Quba Medya işletmesine aittir.
            </p>
          </div>

          {/* Detailed Content */}
          <div className="space-y-10 text-[14px] leading-relaxed text-slate-700">
            {/* Section 1 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                1. Veri Sorumlusu ve İşletme Bilgisi
              </h2>
              <p>
                Quba AI platformu üzerinden toplanan veya işlenen tüm kişisel veriler açısından veri sorumlusu, Türkiye Cumhuriyeti kanunlarına uygun olarak kurulmuş ve faaliyet gösteren Quba Medya markasıdır (Bundan böyle &quot;Quba Medya&quot; veya &quot;İşletme&quot; olarak anılacaktır). İşletme ve iletişim bilgileri aşağıdaki gibidir:
              </p>
              <ul className="list-disc pl-6 space-y-1 mt-2 text-slate-600">
                <li><strong>Vergi Dairesi &amp; VKN:</strong> Meram VD. / 3410314137</li>
                <li><strong>Adres:</strong> Hacıkaymak Mah. Hatım Sk. B Blok No: 4 İç Kapı No: 18, Selçuklu / Konya 42000, Türkiye</li>
                <li><strong>İrtibat E-postası:</strong> mercan@qubamedya.com</li>
              </ul>
            </section>

            {/* Section 2 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                2. Platformun Amacı
              </h2>
              <p>
                Quba AI, kurumsal B2B (Business-to-Business) modelinde çalışan bir CRM ve iletişim koordinasyon platformudur. Platform, sisteme entegre olan üye işletmelerin (Tenant) son kullanıcılarla veya hastalarla olan yazılı iletişimini resmi Meta API kanalları üzerinden tek bir panelde birleştirir, yapay zeka analitiğiyle hızlandırır ve randevu/takip süreçlerini organize eder.
              </p>
            </section>

            {/* Section 3 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                3. Toplanan Veri Kategorileri
              </h2>
              <p>
                Quba AI platformu, yalnızca entegre olmuş B2B tenant işletmelerinin kendi iş süreçlerini yönetebilmesi amacıyla aşağıdaki veri kategorilerini işlemektedir:
              </p>
              
              <div className="space-y-3 mt-4 pl-4 border-l-2 border-slate-100">
                <div>
                  <h4 className="font-semibold text-slate-900 text-sm">A. Meta Kanallarından Gelen Mesaj Verileri</h4>
                  <p className="text-slate-600 mt-1">
                    İşletmenizin sisteme bağladığı Meta uygulamaları aracılığıyla alınan <strong>WhatsApp, Instagram DM ve Facebook Messenger</strong> yazılı mesaj içerikleri, gönderici telefon numarası, kullanıcı adı ve mesaj zamanı gibi iletişim verileri.
                  </p>
                </div>
                
                <div>
                  <h4 className="font-semibold text-slate-900 text-sm">B. Form Lead Verileri</h4>
                  <p className="text-slate-600 mt-1">
                    Web sitelerinizdeki başvuru formlarından veya reklam kampanyalarınızdan gelen isim, soyisim, telefon numarası, e-posta adresi ve talep detayları gibi başvuru sahibi verileri.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-900 text-sm">C. Kullanım Logları ve Teknik Veriler</h4>
                  <p className="text-slate-600 mt-1">
                    Sisteme giriş yapan panel kullanıcılarının IP adresleri, işlem geçmişleri (audit logs), tarayıcı bilgileri ve sistem performans verileri.
                  </p>
                </div>
              </div>
            </section>

            {/* Section 4 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                4. Verilerin Kullanım Amaçları
              </h2>
              <p>
                Elde edilen veriler aşağıdaki yasal ve operasyonel amaçlar doğrultusunda işlenmektedir:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 text-slate-600">
                <li>B2B üye işletmelerimize çok kanallı ortak gelen kutusu (Shared Inbox) hizmeti sunmak,</li>
                <li>Gelen müşteri/hasta taleplerini yapay zeka dil modelleri aracılığıyla özetlemek ve süreçleri analiz etmek,</li>
                <li>Randevu takvimlerinin oluşturulması, takibi ve işletme içi iş yükü dağılımının koordine edilmesi,</li>
                <li>Yetkisiz işlemlerin engellenmesi, sistem güvenliğinin sağlanması ve yasal audit geçmişi tutulması.</li>
              </ul>
            </section>

            {/* Section 5 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                5. Üçüncü Taraf Sağlayıcılar (Alt İşleyiciler)
              </h2>
              <p>
                Platform hizmetlerinin kesintisiz ve yüksek performansla sunulabilmesi amacıyla belirli teknik altyapı sağlayıcıları ile çalışılmaktadır. Verileriniz, sadece bu sağlayıcıların güvenli ve izole bulut altyapılarında işlenmekte olup, üçüncü taraflara ticari amaçlarla satılmamaktadır:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 text-slate-600">
                <li><strong>Meta Platforms Inc.</strong> (WhatsApp, Instagram ve Messenger API entegrasyonu için mesaj iletimi),</li>
                <li><strong>Google LLC</strong> (Gemini API aracılığıyla konuşmaların özetlenmesi ve niyet analizi),</li>
                <li><strong>Vercel Inc.</strong> (Güvenli, hızlı ve coğrafi yedeklemeli sunucu barındırma altyapısı),</li>
                <li><strong>Neon Inc.</strong> (Her tenant için tamamen izole edilmiş Postgres veritabanı altyapısı),</li>
                <li><strong>Upstash Inc. / QStash</strong> (Zamanlanmış görevler ve asenkron kuyruk yönetimi),</li>
                <li><strong>Telegram Bot API</strong> (İşletme içi gizli gruplara anlık bilgilendirme bildirimleri iletimi).</li>
              </ul>
            </section>

            {/* Section 6 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                6. Veri Saklama ve Silme Politikası
              </h2>
              <p>
                Quba AI, kişisel verileri yalnızca işleme amaçlarının gerektirdiği süre boyunca veya yasal yükümlülüklerin (örneğin Vergi Usul Kanunu veya ilgili mevzuat) öngördüğü saklama süreleri sınırında muhafaza eder. B2B tenant sözleşmesi sona erdiğinde veya talep edildiğinde, ilgili tenant'a ait tüm veritabanı odaları ve API anahtarları geri döndürülemeyecek şekilde veri tabanlarımızdan tamamen silinir.
              </p>
            </section>

            {/* Section 7 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                7. KVKK Kapsamındaki Haklarınız
              </h2>
              <p>
                6698 sayılı Kişisel Verilerin Korunması Kanunu’nun 11. maddesi uyarınca, veri sorumlusuna başvurarak kendinizle ilgili şu haklara sahipsiniz:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 text-slate-600">
                <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme, işlenmişse buna ilişkin bilgi talep etme,</li>
                <li>Kişisel verilerinizin işlenme amacını ve bunların amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
                <li>Yurt içinde veya yurt dışında kişisel verilerin aktarıldığı üçüncü kişileri bilme,</li>
                <li>Kişisel verilerin eksik veya yanlış işlenmiş olması hâlinde bunların düzeltilmesini isteme,</li>
                <li>Kanun'da öngörülen şartlar çerçevesinde kişisel verilerin silinmesini veya yok edilmesini isteme.</li>
              </ul>
            </section>

            {/* Section 8 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                8. Veri Silme Talepleri (Data Deletion Request)
              </h2>
              <p>
                Kullanıcılar veya son kullanıcılar, platform tarafından işlenen kendilerine ait verilerin silinmesini her zaman talep edebilirler. Meta kurallarına uygun olarak hazırlanmış detaylı veri silme kılavuzumuza ve izlenmesi gereken adımlara <Link href="/data-deletion" className="text-blue-600 hover:underline font-semibold">Veri Silme Talimatları</Link> sayfamızdan ulaşabilirsiniz.
              </p>
            </section>

            {/* Section 9 */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1.5 h-4 bg-blue-600 rounded-sm" />
                9. İletişim ve Başvuru Yöntemi
              </h2>
              <p>
                KVKK kapsamındaki taleplerinizi veya gizlilik konusundaki sorularınızı, sistemimizde kayıtlı e-posta adresiniz üzerinden <strong>mercan@qubamedya.com</strong> adresine yazılı olarak iletebilirsiniz. Başvurularınız, yasal süre olan en geç 30 (otuz) gün içerisinde değerlendirilerek ücretsiz bir şekilde yanıtlandırılacaktır.
              </p>
            </section>
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
