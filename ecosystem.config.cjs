module.exports = {
  apps: [
    {
      name: 'remy-year-frame',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: ['src', 'public'],
      ignore_watch: ['node_modules', 'public/uploads', '.git', 'backups', 'Date Backup'],
      watch_delay: 1500,
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
