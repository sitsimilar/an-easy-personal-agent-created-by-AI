/**
 * desktop/src/main/debugger/gdb-mi-session.ts 的 MI 文本解析纯函数测试。
 * 覆盖：反转义、*stopped、-stack-list-frames、-stack-list-variables、平衡提取。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractBalanced,
  extractQuoted,
  miUnquote,
  parseFrames,
  parseStopped,
  parseVariables,
  splitTopLevel,
} from '../desktop/src/main/debugger/gdb-mi-session'

test('miUnquote：反转义引号/反斜杠/换行，裸字符串原样返回', () => {
  assert.equal(miUnquote('"hello"'), 'hello')
  assert.equal(miUnquote('"a\\"b"'), 'a"b')
  assert.equal(miUnquote('"C:\\\\Users\\\\x"'), 'C:\\Users\\x')
  assert.equal(miUnquote('"a\\nb"'), 'a\nb')
  assert.equal(miUnquote('bare'), 'bare')
})

test('extractQuoted：提取字段引号值并反转义', () => {
  assert.equal(extractQuoted('reason="breakpoint-hit"', 'reason'), 'breakpoint-hit')
  assert.equal(extractQuoted('{func="main",line="5"}', 'func'), 'main')
  assert.equal(extractQuoted('{func="main",line="5"}', 'line'), '5')
  assert.equal(extractQuoted('{func="main"}', 'missing'), undefined)
})

test('extractBalanced：提取嵌套 frame={...} 记录', () => {
  const rec = '*stopped,reason="breakpoint-hit",frame={addr="0x1",func="main",args=[{name="argc",value="1"}],file="a.cpp",fullname="C:\\\\a.cpp",line="5"},thread-id="1"'
  const frame = extractBalanced(rec, 'frame')
  assert.ok(frame)
  assert.ok(frame!.startsWith('{') && frame!.endsWith('}'))
  assert.ok(frame!.includes('name="argc"'))
})

test('splitTopLevel：忽略引号与嵌套括号内逗号', () => {
  const parts = splitTopLevel('{name="a,b",value="{x,y}"},{name="c"}')
  assert.deepEqual(parts, ['{name="a,b",value="{x,y}"}', '{name="c"}'])
})

test('parseStopped：命中解析 reason 与 frame.line/fullname', () => {
  const rec = '*stopped,reason="breakpoint-hit",disp="keep",bkptno="1",frame={addr="0x4015b0",func="main",args=[],file="main.cpp",fullname="C:\\\\Users\\\\x\\\\a.cpp",line="5"},thread-id="1",stopped-threads="all"'
  const r = parseStopped(rec)
  assert.equal(r.reason, 'breakpoint-hit')
  assert.equal(r.frame?.func, 'main')
  assert.equal(r.frame?.line, 5)
  assert.equal(r.frame?.fullname, 'C:\\Users\\x\\a.cpp')
})

test('parseStopped：exited 无 frame 不抛错', () => {
  const r = parseStopped('*stopped,reason="exited-normally"')
  assert.equal(r.reason, 'exited-normally')
  assert.equal(r.frame, undefined)
})

test('parseFrames：解析 stack 列表', () => {
  const data = '^done,stack=[frame={level="0",func="main",file="a.cpp",fullname="C:\\\\a.cpp",line="5"},frame={level="1",func="foo",file="a.cpp",line="9"}]'
  const frames = parseFrames(data)
  assert.equal(frames.length, 2)
  assert.equal(frames[0].level, 0)
  assert.equal(frames[0].func, 'main')
  assert.equal(frames[0].line, 5)
  assert.equal(frames[1].func, 'foo')
})

test('parseVariables：解析 variables 列表（含 type）', () => {
  const data = '^done,variables=[{name="sum",value="15",type="int"},{name="nums",value="{...}"}]'
  const vars = parseVariables(data)
  assert.equal(vars.length, 2)
  assert.equal(vars[0].name, 'sum')
  assert.equal(vars[0].value, '15')
  assert.equal(vars[0].type, 'int')
  assert.equal(vars[1].type, undefined)
})

test('parseFrames/parseVariables：空数据返回空数组', () => {
  assert.deepEqual(parseFrames('^done'), [])
  assert.deepEqual(parseVariables('^done'), [])
})
