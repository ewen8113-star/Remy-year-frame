#!/usr/bin/env node
/**
 * 发布前版本备份与版本号更新
 *
 * 流程：
 * 1. 读取当前 public/version.json 中的版本号
 * 2. 将当前代码（src、public、配置清单等）完整复制到 version-history/<旧版本>_<时间戳>/
 * 3. 将版本号更新为「操作当日」本地日期：ver.年.月.日
 *
 * 使用：npm run release:backup
 * 回溯：从 version-history 下任一目录取回对应文件覆盖当前项目（勿覆盖 .env）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const VERSION_FILE = path.join(ROOT, 'public', 'version.json');
const HISTORY_DIR = path.join(ROOT, 'version-history');

const COPY_NAMES = ['src', 'public', 'package.json', 'package-lock.json', 'init.sql', 'README.md', '.env.example', 'VERSION'];

const EXCLUDE_TOP = new Set(['node_modules', 'version-history', '.git']);

function readCurrentVersion() {
  try {
    const raw = fs.readFileSync(VERSION_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j.version === 'string' && j.version.trim()) return j.version.trim();
  } catch (_) { /* ignore */ }
  return 'ver.0.0.0';
}

function todayVersionString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `ver.${y}.${m}.${day}`;
}

function timestampSuffix() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeDirName(v) {
  return v.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (EXCLUDE_TOP.has(name)) continue;
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function main() {
  const currentVer = readCurrentVersion();
  const suffix = timestampSuffix();
  const folderName = `${safeDirName(currentVer)}_${suffix}`;
  const destRoot = path.join(HISTORY_DIR, folderName);

  fs.mkdirSync(destRoot, { recursive: true });

  for (const name of COPY_NAMES) {
    const srcPath = path.join(ROOT, name);
    if (!fs.existsSync(srcPath)) continue;
    const destPath = path.join(destRoot, name);
    copyRecursive(srcPath, destPath);
  }

  const manifest = {
    backedUpVersion: currentVer,
    backupFolder: folderName,
    createdAt: new Date().toISOString(),
    note: '发布前快照；回溯时从此目录取回文件覆盖项目根目录对应路径（勿覆盖 .env）',
  };
  fs.writeFileSync(path.join(destRoot, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const nextVer = todayVersionString();
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ version: nextVer }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(ROOT, 'VERSION'), `${nextVer}\n`, 'utf8');

  console.log(`✅ 已备份当前版本 ${currentVer} → ${destRoot}`);
  console.log(`✅ 版本号已更新为 ${nextVer}`);
}

main();
