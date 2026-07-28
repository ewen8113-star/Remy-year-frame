module.exports = {
  apps: [
    {
      name: 'remy-year-frame',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'development',
        PORT: '3088',
        TZ: 'Asia/Shanghai',
      },
    },
  ],
};
