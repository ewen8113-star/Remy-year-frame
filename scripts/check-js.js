const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const includeDirs = ['src', 'public'];
const ignoreDirs = new Set(['node_modules', '.git']);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = includeDirs.flatMap((dir) => {
  const fullPath = path.join(rootDir, dir);
  return fs.existsSync(fullPath) ? walk(fullPath) : [];
});

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(`JS syntax ok (${files.length} files)`);
