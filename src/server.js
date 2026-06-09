const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const db = require('./config/database');
const { testConnection } = db;

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
const materialPurchaseRoutes = require('./routes/materialPurchase');
const propRepairRoutes = require('./routes/propRepair');
const paymentOrderRoutes = require('./routes/paymentOrder');
const inventoryRoutes = require('./routes/inventory');
const dictRoutes = require('./routes/dict');
const quotationRoutes = require('./routes/quotation');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const { mountLookupRoutes } = require('./routes/lookup');
const { requireAuth, requireWriteAccess } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3088;

// 中间件
if (process.env.NODE_ENV === 'production') {
  // 部署在反向代理（如 Sealos Ingress）后，信任首层代理以正确识别 HTTPS，
  // 否则 secure cookie 可能无法在登录后写入浏览器。
  app.set('trust proxy', 1);
}
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({
    name: 'sid',
    secret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 12,
    },
  })
);

const publicDir = path.join(__dirname, '../public');

// 先注册 /api，再挂静态资源：避免旧版 express.static 行为干扰，且新增路由后必须重启 node 才会生效
console.log('注册 auth 路由');
app.use('/api/auth', authRoutes);
// API 禁用 ETag/强缓存，避免筛选类 GET 返回 304 时浏览器复用旧的空列表
app.use('/api', (req, res, next) => {
  res.set('ETag', false);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  return requireAuth(req, res, next);
});
app.use('/api', requireWriteAccess);

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
console.log('注册 material-purchases 路由');
app.use('/api/material-purchases', materialPurchaseRoutes);
console.log('注册 prop-repairs 路由');
app.use('/api/prop-repairs', propRepairRoutes);
console.log('注册 payment-orders 路由');
app.use('/api/payment-orders', paymentOrderRoutes);
console.log('注册 inventory 路由（物资库存）');
app.use('/api/inventory', inventoryRoutes);
console.log('注册 dict 路由（字典/通讯录）');
app.use('/api/dict', dictRoutes);
console.log('注册 quotations 路由（活动报价）');
app.use('/api/quotations', quotationRoutes);
console.log('注册 users 路由');
app.use('/api/users', userRoutes);
console.log('注册 lookups 路由（app 级 /api/lookups）');
mountLookupRoutes(app);

// 测试路由
app.get('/api/test-calendar', (req, res) => {
  res.json({ test: 'calendar works' });
});

// 健康检查（dbConnected 在启动时写入 app.locals）
app.get('/api/health', async (req, res) => {
  const dbOk = req.app.locals.dbConnected === true;
  let activitiesStatusColumnType = null;
  if (dbOk) {
    try {
      const [rows] = await db.query(
        `SELECT COLUMN_TYPE AS t FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activities' AND COLUMN_NAME = 'status'`
      );
      activitiesStatusColumnType = rows[0]?.t ?? null;
    } catch (e) {
      activitiesStatusColumnType = `error: ${e.message}`;
    }
  }
  res.json({
    status: dbOk ? 'ok' : 'degraded',
    message: dbOk ? '人头马年框管理系统 API 运行中' : '服务已启动但数据库未连接，请检查 MySQL 与 .env',
    database: dbOk ? 'connected' : 'disconnected',
    activitiesStatusColumnType,
    features: {
      /** 用于排查「物料采购 404」：若为 false/缺失，说明当前进程未加载含物料路由的代码或未重启 */
      materialPurchasesApi: true,
      inventoryApi: true,
      quotationsPdfApi: true,
    },
  });
});

// 静态文件（禁用强缓存，避免浏览器一直用旧的 app.js / index.html）
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

// 前端页面
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (!req.session?.user?.id) return res.redirect('/login.html');
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.get('/login.html', (req, res, next) => {
  if (req.session?.user?.id) return res.redirect('/');
  return next();
});
app.get('/register.html', (req, res, next) => {
  if (req.session?.user?.id) return res.redirect('/');
  return next();
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
    console.log('📦 物料采购 API: GET/POST /api/material-purchases（若浏览器仍 404，请确认已杀掉旧 node 并重新 npm start）');
  });
}

startServer();
