/**
 * desktop/src/main/provision.ts 的一键部署状态机与 sha256 校验测试（U8、U9）。
 * 注入 fake download/extract/verify，不触发真实网络与解压。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Provisioner,
  constantTimeEqual,
  sha256File,
  sha256Hex,
  type ProvisionDeps,
  type ProvisionDownloadResult,
} from '../desktop/src/main/provision'
import { store } from '../desktop/src/main/store'
import type { CppProvisionEvent } from '../desktop/src/shared/ipc-contract'

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-provision-'))
  return dir
}

function writeBin(dir: string): void {
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(join(dir, 'bin', 'g++.exe'), 'fake-g++')
  writeFileSync(join(dir, 'bin', 'gdb.exe'), 'fake-gdb')
}

function makeDeps(overrides: Partial<ProvisionDeps> & { extract?: ProvisionDeps['extract'] } = {}): {
  deps: ProvisionDeps
  state: { downloaded: boolean }
} {
  const state = { downloaded: false }
  const zipContent = 'fake-zip-content'
  const deps: ProvisionDeps = {
    download: async (
      _url: string,
      destZip: string,
      onProgress: (received: number, total: number | null) => void,
    ): Promise<ProvisionDownloadResult> => {
      state.downloaded = true
      writeFileSync(destZip, zipContent)
      onProgress(zipContent.length, zipContent.length)
      return { receivedBytes: zipContent.length, totalBytes: zipContent.length, sha256: sha256Hex(zipContent) }
    },
    extract: async (zipPath: string, destDir: string): Promise<void> => {
      if (!existsSync(zipPath)) throw new Error('zip 不存在')
      writeBin(destDir)
    },
    verify: async (): Promise<boolean> => true,
    ...overrides,
  }
  return { deps, state }
}

test('U8 成功：下载→校验→解压→注册，无 tmp 残留', async () => {
  const root = makeRoot()
  const mingwDir = join(root, 'mingw64')
  const { deps } = makeDeps()
  const events: CppProvisionEvent[] = []
  const p = new Provisioner()
  const r = await p.provision({
    rootDir: root,
    url: 'https://example.com/toolchain.zip',
    sha256: sha256Hex('fake-zip-content'),
    onEvent: (evt) => events.push(evt),
    deps,
  })
  try {
    assert.equal(r.ok, true)
    assert.equal(r.toolchainDir, mingwDir)
    assert.equal(store.get('toolchainDir'), mingwDir)
    assert.ok(existsSync(join(mingwDir, 'bin', 'g++.exe')))
    assert.ok(!existsSync(join(root, '.provision-tmp')))
    assert.ok(events.some((e) => e.type === 'phase' && e.phase === 'done'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('U8 下载失败：无 mingw64 / tmp 残留', async () => {
  const root = makeRoot()
  const mingwDir = join(root, 'mingw64')
  const { deps } = makeDeps({
    download: async () => {
      throw new Error('network down')
    },
  })
  const p = new Provisioner()
  const r = await p.provision({
    rootDir: root,
    url: 'https://example.com/toolchain.zip',
    sha256: sha256Hex('x'),
    onEvent: () => undefined,
    deps,
  })
  try {
    assert.equal(r.ok, false)
    assert.match(r.message ?? '', /network down/)
    assert.ok(!existsSync(mingwDir))
    assert.ok(!existsSync(join(root, '.provision-tmp')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('U8 sha256 不匹配：拒绝并回滚', async () => {
  const root = makeRoot()
  const mingwDir = join(root, 'mingw64')
  const { deps } = makeDeps({
    download: async (_url, destZip, onProgress) => {
      writeFileSync(destZip, 'fake-zip-content')
      onProgress(16, 16)
      return { receivedBytes: 16, totalBytes: 16, sha256: 'f'.repeat(64) }
    },
  })
  const p = new Provisioner()
  const r = await p.provision({
    rootDir: root,
    url: 'https://example.com/toolchain.zip',
    sha256: sha256Hex('fake-zip-content'),
    onEvent: () => undefined,
    deps,
  })
  try {
    assert.equal(r.ok, false)
    assert.match(r.message ?? '', /sha256 不匹配/)
    assert.ok(!existsSync(mingwDir))
    assert.ok(!existsSync(join(root, '.provision-tmp')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('U8 解压失败：无 mingw64 / tmp 残留', async () => {
  const root = makeRoot()
  const mingwDir = join(root, 'mingw64')
  const { deps } = makeDeps({
    extract: async () => {
      throw new Error('bad zip')
    },
  })
  const p = new Provisioner()
  const r = await p.provision({
    rootDir: root,
    url: 'https://example.com/toolchain.zip',
    sha256: sha256Hex('fake-zip-content'),
    onEvent: () => undefined,
    deps,
  })
  try {
    assert.equal(r.ok, false)
    assert.match(r.message ?? '', /bad zip/)
    assert.ok(!existsSync(mingwDir))
    assert.ok(!existsSync(join(root, '.provision-tmp')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('U8 已就绪：跳过下载直接注册', async () => {
  const root = makeRoot()
  const mingwDir = join(root, 'mingw64')
  writeBin(mingwDir)
  const { deps, state } = makeDeps()
  const p = new Provisioner()
  const r = await p.provision({
    rootDir: root,
    url: 'https://example.com/toolchain.zip',
    sha256: sha256Hex('fake-zip-content'),
    onEvent: () => undefined,
    deps,
  })
  try {
    assert.equal(r.ok, true)
    assert.equal(r.toolchainDir, mingwDir)
    assert.equal(state.downloaded, false)
    assert.equal(store.get('toolchainDir'), mingwDir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('U8 灰度关闭：sha256 未配置直接 failed', async () => {
  const root = makeRoot()
  const { deps, state } = makeDeps()
  const p = new Provisioner()
  const r = await p.provision({
    rootDir: root,
    url: 'https://example.com/toolchain.zip',
    sha256: '',
    onEvent: () => undefined,
    deps,
  })
  try {
    assert.equal(r.ok, false)
    assert.match(r.message ?? '', /校验和未配置/)
    assert.equal(state.downloaded, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('U9 sha256Hex / sha256File / constantTimeEqual', async () => {
  const known = sha256Hex('abc')
  assert.equal(known, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

  assert.equal(constantTimeEqual(known, sha256Hex('abc')), true)
  assert.equal(constantTimeEqual(known, sha256Hex('abd')), false)
  assert.equal(constantTimeEqual(known, known.slice(0, 8)), false)

  const root = makeRoot()
  const file = join(root, 'data.bin')
  writeFileSync(file, 'abc')
  try {
    assert.equal(await sha256File(file), known)
    assert.equal(constantTimeEqual(await sha256File(file), sha256Hex('abc')), true)
    assert.equal(constantTimeEqual(await sha256File(file), 'f'.repeat(64)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
