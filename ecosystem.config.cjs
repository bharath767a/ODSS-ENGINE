/**
 * PM2 Ecosystem Configuration for ODSS
 *
 * This is the PERMANENT process management solution. PM2:
 *   - Auto-restarts processes if they crash
 *   - Survives container restarts (pm2 resurrect)
 *   - Provides logs, monitoring, and health checks
 *   - Replaces the fragile `bun run dev &` + `disown` approach
 *
 * Two processes managed:
 *   1. odss-web: Next.js dev server (port 3000)
 *   2. odss-market: Market data mini-service (port 3002)
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save          # save process list for resurrection
 *   pm2 resurrect     # restore on container restart
 *   pm2 status        # check all processes
 *   pm2 logs          # tail all logs
 */
module.exports = {
  apps: [
    {
      name: 'odss-web',
      cwd: '/home/z/my-project',
      script: 'node_modules/.bin/next',
      args: 'dev -p 3000',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        NODE_OPTIONS: '--max-old-space-size=512',
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '700M',
      watch: false,
      out_file: '/home/z/my-project/.zscripts/pm2-odss-web-out.log',
      error_file: '/home/z/my-project/.zscripts/pm2-odss-web-error.log',
      merge_logs: true,
      time: true,
      kill_timeout: 10000,
      listen_timeout: 30000,
      treekill: true,
    },
    {
      name: 'odss-market',
      cwd: '/home/z/my-project/mini-services/odss-market',
      script: '/usr/local/bin/bun',
      args: '--hot index.ts',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '300M',
      watch: false,
      out_file: '/home/z/my-project/.zscripts/pm2-odss-market-out.log',
      error_file: '/home/z/my-project/.zscripts/pm2-odss-market-error.log',
      merge_logs: true,
      time: true,
      kill_timeout: 10000,
      listen_timeout: 10000,
      treekill: true,
    },
  ],
};
