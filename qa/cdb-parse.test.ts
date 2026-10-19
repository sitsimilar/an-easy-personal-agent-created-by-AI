/**
 * desktop/src/main/debugger/cdb-parse.ts 的纯函数测试（U4–U7）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isCdbPrompt,
  parseCdbBreakpointHit,
  parseCdbExited,
  parseCdbFrames,
  parseCdbLocals,
} from '../desktop/src/main/debugger/cdb-parse'

test('U4 parseCdbLocals：解析 `dv` 输出 name = value', () => {
  const out = [
    '        argc = 0n1',
    '        argv = 0x000000cf`7b3ff9a8',
    '        sum = 0n15',
  ].join('\n')
  const vars = parseCdbLocals(out)
  assert.equal(vars.length, 3)
  assert.deepEqual(vars[0], { name: 'argc', value: '0n1' })
  assert.equal(vars[2].name, 'sum')
  assert.equal(vars[2].value, '0n15')
})

test('U4 parseCdbLocals：忽略非赋值行', () => {
  const vars = parseCdbLocals('Unable to enumerate locals, Win32 error 0n87\n')
  assert.equal(vars.length, 0)
})

test('U5 parseCdbFrames：解析带符号 + file@line 的 `k` 输出', () => {
  const out = [
    ' # Child-SP          RetAddr           Call Site',
    '00 000000cf`7b3ff8f8 00007ff7`22a5102e test!main+0x1e [D:\\tmp\\test.cpp @ 12]',
    '01 000000cf`7b3ff900 00007ff7`22a5105a test!invoke_main+0x1e [d:\\a\\exe_common.inl @ 79]',
  ].join('\n')
  const frames = parseCdbFrames(out)
  assert.equal(frames.length, 2)
  assert.equal(frames[0].level, 0)
  assert.equal(frames[0].func, 'main')
  assert.equal(frames[0].file, 'D:\\tmp\\test.cpp')
  assert.equal(frames[0].line, 12)
  assert.equal(frames[1].func, 'invoke_main')
})

test('U5 parseCdbFrames：无符号时降级 { level, func }', () => {
  const out = '00 000000cf`7b3ff8f8 00007ff7`22a5102e test+0x1010\n'
  const frames = parseCdbFrames(out)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].level, 0)
  assert.equal(frames[0].func, 'test')
  assert.equal(frames[0].file, undefined)
  assert.equal(frames[0].line, undefined)
})

test('U6 parseCdbBreakpointHit / parseCdbExited 三态', () => {
  assert.deepEqual(parseCdbBreakpointHit('Breakpoint 0 hit'), { hit: true, bpNo: 0 })
  assert.equal(parseCdbBreakpointHit('ModLoad: test.exe'), null)
  assert.equal(parseCdbExited('The process has exited').exited, true)
  assert.deepEqual(parseCdbExited('ntdll!ZwTerminateProcess').exited, false)
  assert.equal(parseCdbExited('The process has exited, exit code 0').exitCode, 0)
})

test('U7 isCdbPrompt：识别提示符、防普通输出误判', () => {
  assert.equal(isCdbPrompt('0:000>'), true)
  assert.equal(isCdbPrompt('  1:015>'), true)
  assert.equal(isCdbPrompt('Breakpoint 0 hit'), false)
  assert.equal(isCdbPrompt('sum = 15'), false)
  assert.equal(isCdbPrompt('0:0>'), false)
})
