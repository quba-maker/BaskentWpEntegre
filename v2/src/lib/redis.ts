import { Redis } from '@upstash/redis';

// Determine if we have real Redis credentials available
const hasRedisConfigs = 
  !!process.env.UPSTASH_REDIS_REST_URL && 
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

/**
 * Enterprise Upstash Redis Client
 * Provides a resilient Redis connection for Edge / Serverless environments.
 */
export const redis = hasRedisConfigs
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;
