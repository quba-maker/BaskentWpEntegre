export const dlqSchemaMigration = `
  CREATE TABLE IF NOT EXISTS dead_letter_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    topic VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    error_message TEXT,
    error_stack TEXT,
    failed_at TIMESTAMP DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'unresolved', -- 'unresolved', 'requeued', 'ignored'
    resolved_at TIMESTAMP,
    resolved_by UUID -- Admin User ID
  );

  CREATE INDEX IF NOT EXISTS idx_dlq_tenant ON dead_letter_jobs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_jobs(status);
`;
