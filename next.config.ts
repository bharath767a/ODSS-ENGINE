import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The view-only SHARE build sets ODSS_SHARE=1 to produce a normal build (so
  // `next start` serves it) in a SEPARATE distDir, leaving your running dev on
  // :3000 (which uses the default `.next`) completely untouched.
  output: process.env.ODSS_SHARE === '1' ? undefined : "standalone",
  distDir: process.env.ODSS_DIST_DIR || ".next",
  typescript: {
    ignoreBuildErrors: true,
  },
  // No browser source maps in production → the shared (view-only) build never
  // exposes the engine's TypeScript source.
  productionBrowserSourceMaps: false,
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
