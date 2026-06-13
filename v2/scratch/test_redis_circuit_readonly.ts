import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

async function run() {
  if (!redisUrl || !redisToken) {
    console.error('Redis credentials not found in env');
    process.exit(1);
  }

  // Helper to call Redis REST API
  async function redisGet(key: string) {
    const res = await fetch(`${redisUrl}/get/${key}`, {
      headers: { Authorization: `Bearer ${redisToken}` }
    });
    const data = await res.json();
    return data.result;
  }

  // 1. Get global gemini circuit breaker state and failures
  const globalState = await redisGet('circuit_breaker:gemini:state');
  const globalFailures = await redisGet('circuit_breaker:gemini:failures');

  console.log('\n--- Global Gemini Circuit Breaker ---');
  console.log(`State: ${globalState}`);
  console.log(`Failures count: ${globalFailures}`);

  // 2. We need to check tenant-specific circuit breakers
  // First, fetch the tenant list from database to get tenant IDs
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL!);
  const tenantsResult = await sql.query('SELECT id, slug, name FROM tenants');
  const tenants = tenantsResult.rows || tenantsResult;

  console.log('\n--- Tenant-Specific Gemini Circuit Breakers ---');
  for (const tenant of tenants) {
    const tenantStateKey = `circuit_breaker:gemini:${tenant.id}:state`;
    const tenantFailuresKey = `circuit_breaker:gemini:${tenant.id}:failures`;

    const state = await redisGet(tenantStateKey);
    const failures = await redisGet(tenantFailuresKey);

    console.log(`Tenant: ${tenant.slug} (${tenant.id})`);
    console.log(`  State Key [${tenantStateKey}]: ${state}`);
    console.log(`  Failures Key [${tenantFailuresKey}]: ${failures}`);
  }
}

run().catch(console.error);
