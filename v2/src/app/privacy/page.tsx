export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-[#1D1D1F] mb-2">Gizlilik Politikası</h1>
        <p className="text-sm text-[#86868B] mb-10">Son güncelleme: 13 Mayıs 2026</p>

        <div className="space-y-8 text-[#1D1D1F] text-[15px] leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold mb-3">1. Giriş</h2>
            <p>
              Quba AI (&quot;biz&quot;, &quot;bizim&quot; veya &quot;Platform&quot;), Quba Medya tarafından işletilen 
              bir B2B yapay zeka iletişim platformudur. Bu Gizlilik Politikası, platformumuzu 
              kullanan işletmelerin ve bu işletmelerin müşterilerinin kişisel verilerinin nasıl 
              toplandığını, kullanıldığını ve korunduğunu açıklamaktadır.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">2. Toplanan Veriler</h2>
            <p className="mb-3">Platform aracılığıyla aşağıdaki veriler toplanabilir:</p>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>İsim, telefon numarası ve e-posta adresi</li>
              <li>WhatsApp, Instagram ve Messenger üzerinden gönderilen mesaj içerikleri</li>
              <li>İşletme bilgileri (firma adı, sektör, adres)</li>
              <li>Kullanım istatistikleri ve analitik veriler</li>
              <li>Çerez (cookie) verileri</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">3. Verilerin Kullanım Amacı</h2>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Yapay zeka destekli otomatik müşteri yanıtlama hizmeti sunmak</li>
              <li>İşletmelere CRM (Müşteri İlişkileri Yönetimi) aracı sağlamak</li>
              <li>Hizmet kalitesini artırmak ve analiz yapmak</li>
              <li>Yasal yükümlülükleri yerine getirmek</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">4. Veri Güvenliği</h2>
            <p>
              Verileriniz şifrelenmiş bağlantılar (SSL/TLS) üzerinden iletilir ve güvenli 
              sunucularda saklanır. Her işletmenin verileri birbirinden tamamen izole edilmiş 
              ortamlarda tutulur. Yetkisiz erişime karşı endüstri standardı güvenlik önlemleri 
              uygulanmaktadır.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">5. Üçüncü Taraf Hizmetler</h2>
            <p>Platform, aşağıdaki üçüncü taraf hizmetleri kullanmaktadır:</p>
            <ul className="list-disc pl-6 space-y-1.5 mt-2">
              <li>Meta Platforms (WhatsApp Business API, Instagram Messaging API, Messenger API)</li>
              <li>Google (Gemini AI — yapay zeka modeli)</li>
              <li>Vercel (Barındırma ve sunucu altyapısı)</li>
              <li>Neon (Veritabanı hizmeti)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">6. KVKK Hakları</h2>
            <p>6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında aşağıdaki haklara sahipsiniz:</p>
            <ul className="list-disc pl-6 space-y-1.5 mt-2">
              <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme</li>
              <li>İşlenmişse buna ilişkin bilgi talep etme</li>
              <li>Verilerin silinmesini veya yok edilmesini isteme</li>
              <li>İşlenen verilerin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">7. İletişim</h2>
            <p>
              Gizlilik politikamız hakkında sorularınız için bizimle iletişime geçebilirsiniz:
            </p>
            <p className="mt-2">
              <strong>Quba Medya</strong><br />
              E-posta: info@qubamedya.com<br />
              Web: qubamedya.com
            </p>
          </section>
        </div>

        <div className="mt-16 pt-8 border-t border-black/5">
          <p className="text-xs text-[#86868B]">© 2026 Quba AI — Quba Medya tarafından geliştirilmiştir.</p>
        </div>
      </div>
    </div>
  );
}
