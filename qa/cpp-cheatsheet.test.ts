import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CPP_CHEAT_ENTRIES, CPP_CHEAT_CATEGORY_META } from '../shared/constants/cpp-cheatsheet'
import type { CppCheatCategory } from '../shared/types/domain'

// 合法分类以 CPP_CHEAT_CATEGORY_META 为唯一事实来源（CppCheatCategory 已扩展至 11 类）
const VALID_CATEGORIES: CppCheatCategory[] = Object.keys(CPP_CHEAT_CATEGORY_META) as CppCheatCategory[]

test('CPP_CHEAT_ENTRIES：id 唯一且必填字段完整', () => {
  const ids = new Set(CPP_CHEAT_ENTRIES.map((e) => e.id))
  assert.equal(ids.size, CPP_CHEAT_ENTRIES.length, 'id 必须唯一')
  for (const e of CPP_CHEAT_ENTRIES) {
    assert.ok(e.id, `id 不能为空（name=${e.name}）`)
    assert.ok(e.name, e.id)
    assert.ok(e.description, e.id)
    assert.ok(e.syntax, e.id)
    assert.ok(e.example, e.id)
  }
})

test('CPP_CHEAT_ENTRIES：category 均合法', () => {
  for (const e of CPP_CHEAT_ENTRIES) {
    assert.ok(VALID_CATEGORIES.includes(e.category), `非法分类：${e.category}（id=${e.id}）`)
  }
})

test('CPP_CHEAT_ENTRIES：各分类均有条目', () => {
  for (const c of VALID_CATEGORIES) {
    const count = CPP_CHEAT_ENTRIES.filter((e) => e.category === c).length
    assert.ok(count > 0, `分类 ${c} 无条目`)
  }
})

test('CPP_CHEAT_CATEGORY_META：覆盖全部合法分类', () => {
  for (const c of VALID_CATEGORIES) {
    assert.ok(CPP_CHEAT_CATEGORY_META[c], `缺少分类元信息 ${c}`)
    assert.ok(CPP_CHEAT_CATEGORY_META[c].label, `${c} 缺少 label`)
  }
})

test('CPP_CHEAT_ENTRIES：内容覆盖要求的关键主题', () => {
  const names = CPP_CHEAT_ENTRIES.map((e) => e.name).join(' ')
  const tags = CPP_CHEAT_ENTRIES.flatMap((e) => e.tags ?? []).join(' ')
  const all = `${names} ${tags}`
  // 语法
  assert.match(all, /class|struct/)
  assert.match(all, /template/)
  assert.match(all, /lambda|匿名函数/)
  assert.match(all, /异常|exception/)
  // 标准库
  assert.match(all, /string/)
  assert.match(all, /vector/)
  assert.match(all, /map/)
  assert.match(all, /set/)
  assert.match(all, /智能指针|unique_ptr|shared_ptr/)
  assert.match(all, /ifstream|输入输出|cin/)
  // 算法
  assert.match(all, /sort|排序/)
  assert.match(all, /lower_bound|二分/)
  // 内存管理
  assert.match(all, /new|delete/)
  assert.match(all, /RAII/)
  assert.match(all, /悬垂/)
  // 陷阱
  assert.match(all, /未定义行为|UB/)
  assert.match(all, /迭代器失效/)
  assert.match(all, /切片|slicing/)
})
