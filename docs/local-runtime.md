# 本机运行说明

这套系统当前是一个 Node/Express 服务：

- 后端入口：`src/server.js`
- 前端页面：`public/index.html`、`public/app.js`、`public/style.css`
- 数据库：MySQL，配置来自 `.env`
- 默认访问地址：`http://localhost:3088/`
- 局域网访问地址：`http://Ewens-MacBook-Pro-138.local:3088/`

## 一键启动

双击：

```text
scripts/start-local.command
```

它会先检查 `http://localhost:3088/api/health`：

- 如果服务已经在运行，直接打开浏览器
- 如果服务未运行，并且本机有 PM2，则用 PM2 启动常驻服务
- 如果没有 PM2，则退回 `npm start` 前台模式

## 开机自启

推荐使用 PM2 管理本机常驻服务：

```bash
./scripts/install-macos-launch-agent.sh
```

安装后，Mac 登录时 PM2 会恢复已保存的 `remy-year-frame` 服务。

访问：

```text
http://localhost:3088/
```

局域网内其他设备访问时，不用每次找 IP，直接使用这台 Mac 的本机名称：

```text
http://Ewens-MacBook-Pro-138.local:3088/
```

只要同事和这台 Mac 在同一个局域网/Wi-Fi 下，并且 Mac 已开机、服务在线，这个地址就应该可用。

## 停止开机自启

```bash
./scripts/uninstall-macos-launch-agent.sh
```

这只会从 PM2 中移除当前系统服务，不会删除数据库。

## 常用命令

```bash
npm run service:status   # 查看服务状态
npm run service:restart  # 重启服务
npm run service:logs     # 查看服务日志
npm run service:stop     # 停止服务
```

## 注意

这些脚本只负责启动、停止 Node 服务，不会修改业务数据库数据。
