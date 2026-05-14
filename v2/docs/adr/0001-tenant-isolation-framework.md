# Architecture Decision Record: 0001 - Framework Level Tenant Isolation

## Status
Accepted

## Context
Şu anki Quba AI SaaS yapısında, `tenant_id` filtrelemesi SQL sorgularının içerisine manuel olarak yazılmaktadır (ör: `WHERE tenant_id = ${session.tenantId}`). Bu durum insan hatasına (human-error) açıktır. Bir geliştiricinin filtreyi unutması durumunda cross-tenant data breach (veri sızıntısı) yaşanabilir. Ayrıca loglama ve yetki kontrolleri (RBAC) her Server Action'ın başına manuel olarak kopyalanmaktadır.

## Decision
Sistemi "Zero-Trust" ve "Secure by Default" prensiplerine göre yeniden tasarlama kararı aldık:
1. **Tenant-Aware DB Wrapper:** DB bağlantıları doğrudan çağrılmayacak. `TenantDB` sınıfı üzerinden, instance oluşturulurken verilen `tenant_id` ile sınırlandırılacak. Row-Level Security (RLS) benzeri mantık uygulama katmanında (application layer) zorunlu kılınacak.
2. **Action Guard:** Tüm Next.js Server Action'lar `withTenantAction` veya `withPlatformAction` gibi HOC (Higher Order Function) wrapper'lar ile sarmalanacak. Bu wrapper auth, tenant, RBAC, input validation ve audit logging işlemlerini merkezi olarak yapacak.
3. **Structured Logging:** `console.log` yerine, JSON formatında izlenebilir (traceable) `Logger` sınıfı kullanılacak.

## Consequences
- **Positive:** Geliştiriciler (developer) iş mantığına (business logic) odaklanacak. Güvenlik ve izolasyon framework tarafından otomatik sağlanacak. "Unsafe" sorgu yazmak zorlaşacak.
- **Negative:** Mevcut action'ların yeni yapıya geçirilmesi (migration) zaman alacak. (Çözüm: Incremental migration stratejisi uygulanacak, eski ve yeni yapı bir süre paralel çalışacak).
