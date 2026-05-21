import { getSession } from "@/lib/auth/session";
import { getTenantBootstrapData } from "@/lib/domain/tenant/bootstrap";
import { TenantDB } from "@/lib/core/tenant-db";
import { sql as drizzleSql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { AlertCircle, FileWarning, Activity } from "lucide-react";

export default async function RecoveryPage({ params }: { params: Promise<{ tenant_slug: string }> }) {
  const resolvedParams = await params;
  const session = await getSession();
  
  if (!session || !session.tenantId) {
    notFound();
  }
  
  const tenantData = await getTenantBootstrapData(session.tenantId);
  if (!tenantData || tenantData.profile.slug !== resolvedParams.tenant_slug) {
    notFound();
  }

  const db = new TenantDB(tenantData.profile.id);

  // 1. Unresolved/Orphaned conversations (missing customer_id or channel_id)
  const orphanedConversationsRes = await db.executeSafe(
    `SELECT id, phone_number, channel, created_at, status 
    FROM conversations 
    WHERE tenant_id = $1 AND (channel_id IS NULL OR customer_id IS NULL)
    ORDER BY created_at DESC 
    LIMIT 20`,
    [tenantData.profile.id]
  );
  const orphanedConversations = orphanedConversationsRes || [];

  // 2. Orphaned Messages
  const orphanedMessagesRes = await db.executeSafe(
    `SELECT id, phone_number, direction, channel, created_at, provider_message_id 
    FROM messages 
    WHERE tenant_id = $1 AND (channel_id IS NULL OR group_id IS NULL)
    ORDER BY created_at DESC 
    LIMIT 20`,
    [tenantData.profile.id]
  );
  const orphanedMessages = orphanedMessagesRes || [];

  // 3. Queue Failures / Dead Letter Jobs
  let deadLetters: any[] = [];
  try {
    const dlqRes = await db.executeSafe(
      `SELECT id, topic, error_message, status, created_at 
      FROM dead_letter_jobs 
      WHERE tenant_id = $1 AND status = 'unresolved'
      ORDER BY created_at DESC 
      LIMIT 20`,
      [tenantData.profile.id]
    );
    deadLetters = dlqRes || [];
  } catch (err) {
    // If table doesn't exist yet, just ignore gracefully in UI
  }

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-[--q-text-primary]">Sistem Kurtarma & İzleme</h1>
        <p className="text-sm text-[--q-text-secondary] mt-1">Öksüz kalmış (orphaned) mesajlar, hatalı yönlendirilen webhook'lar ve işlenemeyen kuyruk görevleri.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="dashboard-panel-card p-6">
          <h3 className="text-sm font-medium text-slate-500 mb-2">Öksüz Sohbetler</h3>
          <div className="text-2xl font-bold text-slate-900">{orphanedConversations.length}</div>
          <p className="text-xs text-slate-500 mt-1">Eksik Customer ID veya Channel ID</p>
        </div>

        <div className="dashboard-panel-card p-6">
          <h3 className="text-sm font-medium text-slate-500 mb-2">Eksik Mappings (Mesajlar)</h3>
          <div className="text-2xl font-bold text-slate-900">{orphanedMessages.length}</div>
          <p className="text-xs text-slate-500 mt-1">Eksik Group ID veya Channel ID</p>
        </div>

        <div className="dashboard-panel-card p-6">
          <h3 className="text-sm font-medium text-slate-500 mb-2">Dead Letter (DLQ) Hataları</h3>
          <div className="text-2xl font-bold text-slate-900">{deadLetters.length}</div>
          <p className="text-xs text-slate-500 mt-1">İşlenemeyen kuyruk görevleri</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="dashboard-panel-card p-6">
          <div className="flex items-center space-x-2 mb-2">
            <FileWarning className="w-5 h-5 text-amber-500" />
            <h3 className="text-lg font-bold text-slate-900">Öksüz Sohbetler</h3>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Müşteri profiline veya bir kanala (channel) tam olarak bağlanamamış sohbetler. 
            V1 uyumluluğu nedeniyle veya pipeline hatalarından kaynaklanabilir.
          </p>
          
          {orphanedConversations.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4">
              <h4 className="text-emerald-700 font-medium">Sorun Yok</h4>
              <p className="text-emerald-600 text-sm">Tüm sohbetler doğru şekilde ilişkilendirilmiş.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-2">Telefon</th>
                    <th className="px-4 py-2">Kanal (Legacy)</th>
                    <th className="px-4 py-2">Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {orphanedConversations.map((conv: any) => (
                    <tr key={conv.id} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium">{conv.phone_number}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">{conv.channel || "Bilinmiyor"}</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">
                        {new Date(conv.created_at).toLocaleString('tr-TR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="dashboard-panel-card p-6">
          <div className="flex items-center space-x-2 mb-2">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <h3 className="text-lg font-bold text-slate-900">DLQ (Dead Letter Queue)</h3>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Maximum retry limitine ulaşan ve düşen kuyruk görevleri. Webhook kaybını önler.
          </p>
          
          {deadLetters.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4">
              <h4 className="text-emerald-700 font-medium">Temiz</h4>
              <p className="text-emerald-600 text-sm">Şu anda başarısız kuyruk işlemi bulunmuyor.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-2">Topic</th>
                    <th className="px-4 py-2">Hata</th>
                    <th className="px-4 py-2">Tarih</th>
                  </tr>
                </thead>
                <tbody>
                  {deadLetters.map((dlq: any) => (
                    <tr key={dlq.id} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">{dlq.topic}</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-red-600 truncate max-w-[150px]" title={dlq.error_message}>
                        {dlq.error_message}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500">
                        {new Date(dlq.created_at).toLocaleString('tr-TR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
