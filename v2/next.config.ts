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
      // Eski dosyalar dış kütüphaneleri (root) aradığında v2/node_modules'a yönlendir
      '@neondatabase/serverless': path.resolve(__dirname, 'node_modules/@neondatabase/serverless'),
      'axios': path.resolve(__dirname, 'node_modules/axios'),
    };
    return config;
  },
  // Serverless function timeout (Vercel Pro: 60s, Hobby: 10s)
  serverExternalPackages: ['@neondatabase/serverless'],
};

export default nextConfig;
