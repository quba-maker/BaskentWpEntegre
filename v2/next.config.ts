import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Turbopack yerine Webpack kullanılmasını zorunlu kılmak veya 
  // Turbopack'in uyarı vermesini engellemek için:
  turbopack: {
    resolveAlias: {
      '@lib': path.resolve(__dirname, '../lib'),
    }
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@lib': path.resolve(__dirname, '../lib'),
    };
    return config;
  },
  // Serverless function timeout (Vercel Pro: 60s, Hobby: 10s)
  serverExternalPackages: ['@neondatabase/serverless'],
};

export default nextConfig;
