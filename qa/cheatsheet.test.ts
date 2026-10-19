import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHEAT_ENTRIES, matchKnowledgePoints } from '../shared/constants/cheatsheet'

test('matchKnowledgePoints：识别代码中的关键字/运算符/语法/函数', () => {
  const code = `using System;
class Program {
  static void Main() {
    var list = new List<int>();
    foreach (var x in list) { Console.WriteLine(x); }
    int? n = null;
    var s = n ?? 0;
  }
}`
  const ids = matchKnowledgePoints(code).map((p) => p.id)
  assert.ok(ids.includes('kw-class'), 'class')
  assert.ok(ids.includes('kw-using'), 'using')
  assert.ok(ids.includes('kw-static'), 'static')
  assert.ok(ids.includes('kw-var'), 'var')
  assert.ok(ids.includes('sy-foreach'), 'foreach')
  assert.ok(ids.includes('fn-writeline'), 'Console.WriteLine')
  assert.ok(ids.includes('sy-nullable'), 'int?')
  assert.ok(ids.includes('op-null-coalesce'), '??')
})

test('matchKnowledgePoints：无匹配返回空数组', () => {
  assert.deepEqual(matchKnowledgePoints('hello world 123'), [])
})

test('CHEAT_ENTRIES：id 唯一且必填字段完整', () => {
  const ids = new Set(CHEAT_ENTRIES.map((e) => e.id))
  assert.equal(ids.size, CHEAT_ENTRIES.length)
  for (const e of CHEAT_ENTRIES) {
    assert.ok(e.name, e.id)
    assert.ok(e.description, e.id)
    assert.ok(e.syntax, e.id)
    assert.ok(e.example, e.id)
  }
})
