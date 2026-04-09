const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const { testConnection } = require('./config/database');

require('dotenv').config();

// 路由
const yearFrameRoutes = require('./routes/yearFrame');
const activityRoutes = require('./routes/activity');
const warehouseRoutes = require('./routes/warehouse');
const logisticsRoutes = require('./routes/logistics');
const reimbursementRoutes = require('./routes/reimbursement');
const dashboardRoutes = require('./routes/dashboard');
const backupRoutes = require('./routes/backup');
const calendarRoutes = require('./routes/calendar');
const costRoutes = require('./routes/cost');
const wineRoutes = require('./routes/wine');
const brandRoutes = require('./routes/brand');

const app = express();
const PORT = process.env.PORT || 3088;

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 静态文件（禁用强缓存，避免浏览器一直用旧的 app.js / index.html）
const publicDir = path.join(__dirname, '../public');
app.use(
  express.static(publicDir, {
    etag: false,
    lastModified: false,
    setHeaders(res, filePath) {
      if (/\.(html|js|css|json)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    },
  })
);

// API 路由
console.log('注册 year-frames 路由');
app.use('/api/year-frames', yearFrameRoutes);
console.log('注册 activities 路由');
app.use('/api/activities', activityRoutes);
console.log('注册 warehouse 路由');
app.use('/api/warehouse', warehouseRoutes);
console.log('注册 logistics 路由');
app.use('/api/logistics', logisticsRoutes);
console.log('注册 reimbursements 路由');
app.use('/api/reimbursements', reimbursementRoutes);
console.log('注册 dashboard 路由');
app.use('/api/dashboard', dashboardRoutes);
console.log('注册 backup 路由');
app.use('/api/backup', backupRoutes);
console.log('注册 calendar 路由');
app.use('/api/calendar', calendarRoutes);
console.log('注册 cost 路由');
app.use('/api/cost', costRoutes);
console.log('注册 wine 路由');
app.use('/api/wine', wineRoutes);
console.log('注册 brand 路由');
app.use('/api/brand', brandRoutes);

// 测试路由
app.get('/api/test-calendar', (req, res) => {
  res.json({ test: 'calendar works' });
});

// 健康检查（dbConnected 在启动时写入 app.locals）
app.get('/api/health', (req, res) => {
  const dbOk = req.app.locals.dbConnected === true;
  res.json({
    status: dbOk ? 'ok' : 'degraded',
    message: dbOk ? '人头马年框管理系统 API 运行中' : '服务已启动但数据库未连接，请检查 MySQL 与 .env',
    database: dbOk ? 'connected' : 'disconnected',
  });
});

// 前端页面
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(publicDir, 'index.html'));
});

// 错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器（数据库失败时仍监听端口，避免「浏览器完全打不开」；接口需库连上后才正常）
async function startServer() {
  let dbConnected = false;
  try {
    dbConnected = await testConnection();
  } catch (e) {
    console.error('数据库检测异常:', e && e.message ? e.message : e);
  }
  app.locals.dbConnected = dbConnected;

  if (!dbConnected) {
    console.warn('⚠️  MySQL 未连接：页面 http://localhost:' + PORT + ' 仍可打开，数据接口将报错。请启动 MySQL 并核对 .env 中 DB_* 配置。');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 服务器运行中: http://localhost:${PORT}`);
    if (dbConnected) console.log('✅ 数据库已连接');
  });
}

startServer();
