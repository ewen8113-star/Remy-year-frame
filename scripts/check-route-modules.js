const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const routeNames = [
  'activity',
  'auth',
  'backup',
  'brand',
  'calendar',
  'cost',
  'dashboard',
  'dict',
  'inventory',
  'logistics',
  'materialPurchase',
  'paymentOrder',
  'propRepair',
  'quotation',
  'reconcile',
  'reimbursement',
  'user',
  'warehouse',
  'wine',
  'yearFrame',
];

for (const routeName of routeNames) {
  const routePath = path.join(rootDir, 'src', 'routes', routeName);
  const router = require(routePath);
  if (typeof router !== 'function' || typeof router.use !== 'function') {
    throw new TypeError(`路由模块 ${routeName} 未导出 Express Router`);
  }
}

const lookupModule = require(path.join(rootDir, 'src', 'routes', 'lookup'));
if (typeof lookupModule.mountLookupRoutes !== 'function') {
  throw new TypeError('路由模块 lookup 未导出 mountLookupRoutes');
}

console.log(`Route module load ok (${routeNames.length + 1} files)`);
process.exit(0);
