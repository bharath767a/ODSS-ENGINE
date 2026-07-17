/**
 * PM2 Ecosystem Configuration for ODSS — PERMANENT
 *
 * CRITICAL: The web server MUST use --webpack flag (NOT Turbopack).
 * Turbopack crashes repeatedly with "corrupted database" panics.
 * Webpack is stable and reliable.
 *
 * The market service env MUST include DATABASE_URL pointing to
 * /home/z/odss-data/custom.db (NOT the default project db/ folder).
 */
module.exports = {
  apps: [
    {
      name: 'odss-web',
      cwd: '/home/z/my-project',
      script: 'node_modules/.bin/next',
      args: 'dev -p 3000 --webpack',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        NODE_OPTIONS: '--max-old-space-size=1024',
        DATABASE_URL: 'file:/home/z/odss-data/custom.db',
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '1200M',
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
        DATABASE_URL: 'file:/home/z/odss-data/custom.db',
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
