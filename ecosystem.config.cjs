module.exports = {
  apps: [{
    name: 'coh-erp',
    script: 'server/src/production.js',
    interpreter: 'tsx',
    cwd: '/app/COH-ERP2',
    env: {
      NODE_ENV: 'production',
      TZ: 'UTC',
    },
    max_memory_restart: '1G',
    exp_backoff_restart_delay: 100,
    // Zero-downtime reload: old process stays alive until new one signals ready
    wait_ready: true,
    listen_timeout: 30000,
    // Graceful shutdown: give connections time to drain
    kill_timeout: 10000,
  }],
};
