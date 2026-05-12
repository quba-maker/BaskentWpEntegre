import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Parent directory'deki lib/ klasöründen import yapabilmek için
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
