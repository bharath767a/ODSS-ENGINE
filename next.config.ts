import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Prevent Fast Refresh from rebuilding when log files, DB, or data files change.
  // This was causing the dashboard to "jump" (flash/reload) every few seconds.
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/.next/**',
          '**/node_modules/**',
          '**/.git/**',
          '**/db/**',
          '**/*.db',
          '**/.zscripts/**',
          '**/upload/**',
          '**/backups/**',
          '**/nse-bridge/**',
          '**/*.log',
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
