// 个人信息管家 · 部署用极简静态服务器（纯 Node，无第三方依赖）
// 职责：确保 web/dist 已构建，然后用 Node 原生 http 服务 web/dist，带 SPA 回退。
// 依赖安装已在部署的 installCmd 阶段完成；此处仅在 dist 缺失时兜底构建。
const { execSync } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')

const root = __dirname
const webDir = path.join(root, 'web')
const distDir = path.join(webDir, 'dist')

// 当前部署版本号（根 package.json 的 version），用于 /version.json 更新源端点。
const appVersion = (() => {
  try {
    return require(path.join(root, 'package.json')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

// 若尚未构建则先构建（依赖已安装；用 vite build 跳过 tsc 类型检查，避免沙箱残留孤儿文件报错）
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  try {
    execSync('./node_modules/.bin/vite build', { cwd: webDir, stdio: 'inherit' })
  } catch (e) {
    console.error('web build failed:', e && e.message ? e.message : e)
    process.exit(1)
  }
}

const PORT = Number(process.env.PORT) || 3000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

http
  .createServer((req, res) => {
    let urlPath
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    } catch {
      urlPath = '/'
    }
    if (urlPath === '/') urlPath = '/index.html'

    // 更新源端点：返回当前部署版本号（供客户端更新检测比较）
    if (urlPath === '/version.json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ version: appVersion }))
      return
    }

    let file = path.join(distDir, urlPath)
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      file = path.join(distDir, 'index.html') // SPA 回退
    }
    const ext = path.extname(file).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log('personal-agent serving on 0.0.0.0:' + PORT)
  })
