export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-[#1D1D1F] mb-2">Kullanım Koşulları</h1>
        <p className="text-sm text-[#86868B] mb-10">Son güncelleme: 13 Mayıs 2026</p>

        <div className="space-y-8 text-[#1D1D1F] text-[15px] leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold mb-3">1. Hizmet Tanımı</h2>
            <p>
              Quba AI, işletmelere yapay zeka destekli çok kanallı (omnichannel) müşteri 
              iletişim ve CRM hizmeti sunan bir B2B yazılım platformudur. Platform; WhatsApp, 
              Instagram ve Facebook Messenger kanalları üzerinden otomatik müşteri yanıtlama, 
              lead yönetimi ve analitik hizmetleri sağlar.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">2. Kullanım Şartları</h2>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Platform yalnızca yasal ticari amaçlarla kullanılabilir.</li>
              <li>Kullanıcılar, Meta Platform Politikalarına uymakla yükümlüdür.</li>
              <li>Spam, toplu istenmeyen mesaj gönderimi ve yanıltıcı içerik paylaşımı kesinlikle yasaktır.</li>
              <li>Her işletme, kendi müşterilerinden gerekli izinleri (KVKK onayı vb.) almaktan sorumludur.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">3. Hesap Güvenliği</h2>
            <p>
              Kullanıcılar, hesap bilgilerinin gizliliğini korumakla yükümlüdür. 
              Yetkisiz erişim tespit edilmesi halinde Quba AI, hesabı askıya alma 
              hakkını saklı tutar.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">4. Yapay Zeka Kullanımı</h2>
            <p>
              Platform, Google Gemini ve benzeri yapay zeka modelleri kullanmaktadır. 
              AI tarafından üretilen yanıtlar bilgilendirme amaçlıdır ve profesyonel 
              tavsiye niteliği taşımaz. İşletmeler, AI yanıtlarının doğruluğunu 
              denetlemekten sorumludur.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">5. Faturalandırma</h2>
            <p>
              Hizmet ücretleri, seçilen plan ve kullanım miktarına göre belirlenir. 
              Aylık faturalar, dönem sonunda otomatik olarak oluşturulur. 
              Ödeme yapılmaması halinde hizmet askıya alınabilir.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">6. Hizmet Sınırlamaları</h2>
            <ul className="list-disc pl-6 space-y-1.5">
              <li>Platform, Meta API&apos;lerinin kullanılabilirliğine bağımlıdır.</li>
              <li>Meta politika değişiklikleri hizmet kapsamını etkileyebilir.</li>
              <li>Planlı bakım çalışmaları önceden bildirilir.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">7. Sorumluluk Sınırı</h2>
            <p>
              Quba AI, yapay zeka tarafından üretilen içeriklerin doğruluğunu garanti 
              etmez. İşletmeler, platformu kullanarak müşterilerine sundukları 
              hizmetlerden kendileri sorumludur.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-3">8. İletişim</h2>
            <p>
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
