const express = require('express');
const path = require('path');
const { execFile } = require('child_process');

const router = express.Router();
const PROJECT_ROOT = path.join(__dirname, '../..');

function runGitPull() {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['pull', '--ff-only'],
      { cwd: PROJECT_ROOT, timeout: 60000 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          output: String(stdout || '').trim(),
          error: err ? String((stderr || err.message || '').trim()) : '',
        });
      }
    );
  });
}

function scheduleRestart() {
  setTimeout(() => {
    process.exit(0);
  }, 400);
}

router.get('/status', (req, res) => {
  res.json({
    data: {
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      nodeEnv: process.env.NODE_ENV || '',
      port: Number(process.env.PORT || 3088),
      managedByPm2: process.env.pm_id != null && process.env.pm_id !== '',
    },
  });
});

/** 管理员：可选 git pull 后退出进程，由 PM2 自动拉起新代码 */
router.post('/reload', async (req, res) => {
  try {
    const pull = req.body && (req.body.pull === true || req.body.pull === 1 || req.body.pull === '1');
    let git = { ok: true, output: '', error: '' };
    if (pull) git = await runGitPull();
    const managedByPm2 = process.env.pm_id != null && process.env.pm_id !== '';
    res.json({
      data: {
        ok: true,
        pullAttempted: !!pull,
        git,
        managedByPm2,
        message: managedByPm2 ? '服务即将自动重启' : '进程即将退出，请用本机启动方式重新打开服务',
      },
    });
    scheduleRestart();
  } catch (e) {
    res.status(500).json({ error: e.message || '重启失败' });
  }
});

module.exports = router;
