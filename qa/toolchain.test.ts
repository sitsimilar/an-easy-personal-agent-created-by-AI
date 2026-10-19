/**
 * desktop/src/main/toolchain.ts 的纯函数测试（U1–U3）。
 * 覆盖：selectPairing（VS/MSVC 优先 + 残缺降级）、locateVcvars、msvcVersionOf。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  locateVcvars,
  msvcVersionOf,
  selectPairing,
} from '../desktop/src/main/toolchain'
import type { ToolchainItem } from '../desktop/src/shared/ipc-contract'

const ok = (extra: Partial<ToolchainItem> = {}): ToolchainItem => ({ ok: true, ...extra })
const bad = (error = '不可用'): ToolchainItem => ({ ok: false, error })

test('U1 selectPairing：msvc 齐全时 VS/MSVC 优先', () => {
  const r = selectPairing({ gpp: ok(), gdb: ok(), cl: ok(), cdb: ok() })
  assert.equal(r.compiler, 'cl')
  assert.equal(r.debugger, 'cdb')
  assert.equal(r.ready, true)
  assert.equal(r.canDebug, true)
})

test('U1 selectPairing：仅 MinGW 齐全时回退 g++/gdb', () => {
  const r = selectPairing({ gpp: ok(), gdb: ok(), cl: bad(), cdb: bad() })
  assert.equal(r.compiler, 'gpp')
  assert.equal(r.debugger, 'gdb')
  assert.equal(r.ready, true)
  assert.equal(r.canDebug, true)
})

test('U1 selectPairing：仅 g++（缺 gdb）→ 编译可用、不可调试', () => {
  const r = selectPairing({ gpp: ok(), gdb: bad(), cl: bad(), cdb: bad() })
  assert.equal(r.compiler, 'gpp')
  assert.equal(r.debugger, null)
  assert.equal(r.ready, true)
  assert.equal(r.canDebug, false)
  assert.ok(r.reason && r.reason.includes('gdb'))
})

test('U1 selectPairing：仅 cl（缺 cdb）→ 编译可用、不可调试', () => {
  const r = selectPairing({ gpp: bad(), gdb: bad(), cl: ok(), cdb: bad() })
  assert.equal(r.compiler, 'cl')
  assert.equal(r.debugger, null)
  assert.equal(r.ready, true)
  assert.equal(r.canDebug, false)
  assert.ok(r.reason && r.reason.includes('cdb'))
})

test('U1 selectPairing：仅调试器（缺编译器）→ 全禁用', () => {
  const r = selectPairing({ gpp: bad(), gdb: ok(), cl: bad(), cdb: bad() })
  assert.equal(r.compiler, null)
  assert.equal(r.debugger, null)
  assert.equal(r.ready, false)
  assert.equal(r.canDebug, false)
  assert.ok(r.reason)
})

test('U1 selectPairing：全缺失 → 全禁用', () => {
  const r = selectPairing({ gpp: bad(), gdb: bad(), cl: bad(), cdb: bad() })
  assert.equal(r.compiler, null)
  assert.equal(r.debugger, null)
  assert.equal(r.ready, false)
  assert.equal(r.canDebug, false)
  assert.ok(r.reason)
})

test('U2 locateVcvars：由 cl.exe 反推 vcvars64.bat', () => {
  const cl = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Tools\\MSVC\\14.39.33519\\bin\\Hostx64\\x64\\cl.exe'
  assert.equal(locateVcvars(cl), 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat')
})

test('U2 locateVcvars：无 VC 标记返回空串', () => {
  assert.equal(locateVcvars('C:\\other\\cl.exe'), '')
})

test('U3 msvcVersionOf：目录名 14.39 → 19.39', () => {
  assert.equal(msvcVersionOf('C:\\VC\\Tools\\MSVC\\14.39.33519\\bin\\Hostx64\\x64\\cl.exe'), '19.39')
})

test('U3 msvcVersionOf：无匹配返回 MSVC', () => {
  assert.equal(msvcVersionOf('C:\\other\\cl.exe'), 'MSVC')
})
