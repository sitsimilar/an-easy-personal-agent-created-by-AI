#!/usr/bin/env node
/**
 * QA 测试一键编译 + 运行脚本（Node + esbuild JS API + node:test）。
 * 用 JS API 传 alias 可避免 Git Bash/MSYS 对 `@/lib/cloud` 之类参数的路径改写。
 * 运行：node qa/run-tests.mjs
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = resolve(root, 'qa', 'dist')
mkdirSync(distDir, { recursive: true })

// esbuild 位于 web/node_modules（ESM 源码，用 require 拉取 CJS 入口）
const esbuild = require(resolve(root, 'web', 'node_modules', 'esbuild', 'lib', 'main.js'))
const { build } = esbuild

const electronAlias = { electron: resolve(root, 'qa', 'mocks', 'electron.ts') }
const webAlias = {
  '@/lib/cloud': resolve(root, 'qa', 'mocks', 'cloud.ts'),
  '@': resolve(root, 'web', 'src'),
  '@shared': resolve(root, 'shared'),
}

const targets = [
  { entry: 'qa/llm.test.ts', out: 'qa/dist/llm.test.cjs', alias: {} },
  { entry: 'qa/constants.test.ts', out: 'qa/dist/constants.test.cjs', alias: {} },
  { entry: 'qa/cheatsheet.test.ts', out: 'qa/dist/cheatsheet.test.cjs', alias: {} },
  { entry: 'qa/cpp-cheatsheet.test.ts', out: 'qa/dist/cpp-cheatsheet.test.cjs', alias: {} },
  { entry: 'qa/solution-reader.test.ts', out: 'qa/dist/solution-reader.test.cjs', alias: {} },
  { entry: 'qa/analysis-exporter.test.ts', out: 'qa/dist/analysis-exporter.test.cjs', alias: electronAlias },
  { entry: 'qa/floating-geometry.test.ts', out: 'qa/dist/floating-geometry.test.cjs', alias: {} },
  { entry: 'qa/store.test.ts', out: 'qa/dist/store.test.cjs', alias: electronAlias },
  { entry: 'qa/analysis-orchestrator.test.ts', out: 'qa/dist/analysis-orchestrator.test.cjs', alias: electronAlias },
  { entry: 'qa/selection-analyzer.test.ts', out: 'qa/dist/selection-analyzer.test.cjs', alias: electronAlias },
  { entry: 'qa/main-window.test.ts', out: 'qa/dist/main-window.test.cjs', alias: electronAlias },
  { entry: 'qa/aiService-selection.test.ts', out: 'qa/dist/aiService-selection.test.cjs', alias: webAlias },
  { entry: 'qa/aiService-p1.test.ts', out: 'qa/dist/aiService-p1.test.cjs', alias: webAlias },
  { entry: 'qa/recordService-listByRange.test.ts', out: 'qa/dist/recordService-listByRange.test.cjs', alias: webAlias },
  { entry: 'qa/recordService-crud.test.ts', out: 'qa/dist/recordService-crud.test.cjs', alias: webAlias },
  { entry: 'qa/aiService-classify.test.ts', out: 'qa/dist/aiService-classify.test.cjs', alias: webAlias },
  { entry: 'qa/recordStore-race.test.ts', out: 'qa/dist/recordStore-race.test.cjs', alias: webAlias },
  { entry: 'qa/mindtree.test.ts', out: 'qa/dist/mindtree.test.cjs', alias: webAlias },
  { entry: 'qa/mindforest-store.test.ts', out: 'qa/dist/mindforest-store.test.cjs', alias: webAlias },
  { entry: 'qa/mindforest-cross.test.ts', out: 'qa/dist/mindforest-cross.test.cjs', alias: webAlias },
  { entry: 'qa/mindforest-cloud.test.ts', out: 'qa/dist/mindforest-cloud.test.cjs', alias: webAlias },
  { entry: 'qa/errors.test.ts', out: 'qa/dist/errors.test.cjs', alias: {} },
  { entry: 'qa/update-service.test.ts', out: 'qa/dist/update-service.test.cjs', alias: webAlias },
  { entry: 'qa/image-service.test.ts', out: 'qa/dist/image-service.test.cjs', alias: webAlias },
  { entry: 'qa/profile-service.test.ts', out: 'qa/dist/profile-service.test.cjs', alias: webAlias },
  { entry: 'qa/cpp-runner.test.ts', out: 'qa/dist/cpp-runner.test.cjs', alias: {} },
  { entry: 'qa/toolchain.test.ts', out: 'qa/dist/toolchain.test.cjs', alias: electronAlias },
  { entry: 'qa/cdb-parse.test.ts', out: 'qa/dist/cdb-parse.test.cjs', alias: {} },
  { entry: 'qa/provision.test.ts', out: 'qa/dist/provision.test.cjs', alias: electronAlias },
  { entry: 'qa/recurrence.test.ts', out: 'qa/dist/recurrence.test.cjs', alias: {} },
  { entry: 'qa/recurrence-service.test.ts', out: 'qa/dist/recurrence-service.test.cjs', alias: webAlias },
  { entry: 'qa/reminder-schedule.test.ts', out: 'qa/dist/reminder-schedule.test.cjs', alias: {} },
  { entry: 'qa/link-preview.test.ts', out: 'qa/dist/link-preview.test.cjs', alias: {} },
  // P0 对抗性测试（QA 独立补充）
  { entry: 'qa/p0-a-reminder-schedule-adversarial.test.ts', out: 'qa/dist/p0-a-reminder-schedule-adversarial.test.cjs', alias: {} },
  { entry: 'qa/p0-a-reminder-service.test.ts', out: 'qa/dist/p0-a-reminder-service.test.cjs', alias: webAlias },
  { entry: 'qa/p0-a-notification-provider.test.ts', out: 'qa/dist/p0-a-notification-provider.test.cjs', alias: webAlias },
  { entry: 'qa/p0-a-notification-chain.test.ts', out: 'qa/dist/p0-a-notification-chain.test.cjs', alias: {} },
  { entry: 'qa/p0-a-permission-probe.test.ts', out: 'qa/dist/p0-a-permission-probe.test.cjs', alias: webAlias },
  { entry: 'qa/p0-a-desktop-notifier.test.ts', out: 'qa/dist/p0-a-desktop-notifier.test.cjs', alias: electronAlias },
  { entry: 'qa/p0-b-recurrence-adversarial.test.ts', out: 'qa/dist/p0-b-recurrence-adversarial.test.cjs', alias: {} },
  { entry: 'qa/p0-b-recurrence-service-adversarial.test.ts', out: 'qa/dist/p0-b-recurrence-service-adversarial.test.cjs', alias: webAlias },
  { entry: 'qa/p0-c-link-preview-http.test.ts', out: 'qa/dist/p0-c-link-preview-http.test.cjs', alias: {} },
  { entry: 'qa/p0-c-transport-post.test.ts', out: 'qa/dist/p0-c-transport-post.test.cjs', alias: {} },
  { entry: 'qa/p0-c-domain-resolution-regression.test.ts', out: 'qa/dist/p0-c-domain-resolution-regression.test.cjs', alias: {} },
  { entry: 'qa/p0-c-server-smoke.test.ts', out: 'qa/dist/p0-c-server-smoke.test.cjs', alias: {} },
  { entry: 'qa/p0-e-frontend-safety.test.ts', out: 'qa/dist/p0-e-frontend-safety.test.cjs', alias: webAlias },
]

// 云服务配置已参数化为 import.meta.env.VITE_*；测试环境无 Vite 注入，
// 用 esbuild define 把 import.meta.env 替换为空值对象（配合源码里的 ?? 兜底）。
const importMetaEnvDefine = {
  'import.meta.env': JSON.stringify({
    VITE_CLOUD_ENDPOINT: '',
    VITE_OAUTH_RELAY_BASE_URL: '',
    VITE_CLOUD_PUBLISHABLE_KEY: '',
    VITE_WEB_APP_URL: '',
  }),
}

console.log('==> 编译测试文件（esbuild bundle）')
for (const t of targets) {
  await build({
    entryPoints: [resolve(root, t.entry)],
    outfile: resolve(root, t.out),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    alias: t.alias,
    define: { ...importMetaEnvDefine, ...(t.define ?? {}) },
    minify: t.minify ?? false,
    logLevel: 'warning',
    target: 'node20',
  })
  console.log(`  built ${t.out}`)
}

const files = targets.map((t) => resolve(root, t.out))
console.log('==> 运行 node:test')
execFileSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
