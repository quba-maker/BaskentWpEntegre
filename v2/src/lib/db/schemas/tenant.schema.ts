export const tenantSchemaMigration = `
  -- Tenant's current onboarding stage
  CREATE TYPE onboarding_status AS ENUM ('started', 'channel_connected', 'ai_configured', 'billing_completed', 'active');
  
  -- Subscription Tier
  CREATE TYPE subscription_tier AS ENUM ('free_trial', 'starter', 'pro', 'enterprise');

  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_step onboarding_status DEFAULT 'started';
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS industry VARCHAR(50);
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'Europe/Istanbul';
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_tier subscription_tier DEFAULT 'free_trial';
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP;
  
  -- Quota & Overage tracking
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS monthly_message_quota INT DEFAULT 1000;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS allow_overage BOOLEAN DEFAULT false;

  -- API Verifications
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_whatsapp_verified BOOLEAN DEFAULT false;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_instagram_verified BOOLEAN DEFAULT false;
  
  -- Marketplace / Packages
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS active_template_pack VARCHAR(100) DEFAULT 'general';
`;
