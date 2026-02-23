module.exports = {
  apps: [{
    name: 'coh-erp',
    script: 'server/src/production.js',
    interpreter: 'tsx',
    cwd: '/app/COH-ERP2',
    env: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '1G',
    exp_backoff_restart_delay: 100,
  }],
};
