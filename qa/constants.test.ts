/**
 * shared/constants/categories.ts 与 prompts.ts 结构完整性测试。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRESET_CATEGORIES,
  PRESET_CATEGORY_KEYS,
  categoryColor,
  tagColor,
} from '../shared/constants/categories'
import {
  ANALYZE_SELECTION_SYSTEM_PROMPT,
  CLASSIFY_SYSTEM_PROMPT,
  EXTRACT_KEY_POINTS_SYSTEM_PROMPT,
  MIND_TREE_SYSTEM_PROMPT,
  ORGANIZE_TODOS_SYSTEM_PROMPT,
  RELATE_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
} from '../shared/constants/prompts'

/* ------------------------------------------------------------------ *
 * categories
 * ------------------------------------------------------------------ */

test('分类列表非空', () => {
  assert.ok(PRESET_CATEGORIES.length > 0)
})

test('每个分类都有非空 key/label/color', () => {
  for (const c of PRESET_CATEGORIES) {
    assert.equal(typeof c.key, 'string')
    assert.equal(typeof c.label, 'string')
    assert.equal(typeof c.color, 'string')
    assert.ok(c.key.length > 0, `分类 key 为空：${JSON.stringify(c)}`)
    assert.ok(c.label.length > 0)
    assert.ok(/^#[0-9a-fA-F]{6}$/.test(c.color), `颜色格式非法：${c.color}`)
  }
})

test('分类 key 唯一', () => {
  const keys = PRESET_CATEGORIES.map((c) => c.key)
  assert.equal(new Set(keys).size, keys.length)
})

test('PRESET_CATEGORY_KEYS 与分类列表一一对应', () => {
  assert.equal(PRESET_CATEGORY_KEYS.length, PRESET_CATEGORIES.length)
  assert.deepEqual(
    new Set(PRESET_CATEGORY_KEYS),
    new Set(PRESET_CATEGORIES.map((c) => c.key)),
  )
})

test('categoryColor：命中预置分类返回对应颜色', () => {
  for (const c of PRESET_CATEGORIES) {
    assert.equal(categoryColor(c.key), c.color)
  }
})

test('categoryColor：未知分类返回默认灰色', () => {
  assert.equal(categoryColor('不存在的分类'), '#94a3b8')
})

test('categoryColor：空值返回默认灰色', () => {
  assert.equal(categoryColor(''), '#94a3b8')
  assert.equal(categoryColor(null), '#94a3b8')
  assert.equal(categoryColor(undefined), '#94a3b8')
})

test('tagColor：返回合法 hex 颜色且对同一输入稳定', () => {
  const a = tagColor('人工智能')
  const b = tagColor('人工智能')
  assert.ok(/^#[0-9a-fA-F]{6}$/.test(a))
  assert.equal(a, b)
})

test('tagColor：空标签不抛错且返回合法颜色', () => {
  assert.ok(/^#[0-9a-fA-F]{6}$/.test(tagColor('')))
})

/* ------------------------------------------------------------------ *
 * prompts
 * ------------------------------------------------------------------ */

test('四个 AI 场景的 system prompt 均非空', () => {
  const prompts: Record<string, string> = {
    CLASSIFY_SYSTEM_PROMPT,
    SUMMARIZE_SYSTEM_PROMPT,
    RELATE_SYSTEM_PROMPT,
    MIND_TREE_SYSTEM_PROMPT,
  }
  for (const [name, p] of Object.entries(prompts)) {
    assert.equal(typeof p, 'string', `${name} 不是字符串`)
    assert.ok(p.trim().length > 0, `${name} 为空`)
  }
})

test('选区分析 prompt 非空且含三类关键词', () => {
  assert.equal(typeof ANALYZE_SELECTION_SYSTEM_PROMPT, 'string')
  assert.ok(ANALYZE_SELECTION_SYSTEM_PROMPT.trim().length > 0)
  assert.ok(ANALYZE_SELECTION_SYSTEM_PROMPT.includes('syntax'))
  assert.ok(ANALYZE_SELECTION_SYSTEM_PROMPT.includes('defect'))
  assert.ok(ANALYZE_SELECTION_SYSTEM_PROMPT.includes('style'))
  assert.ok(ANALYZE_SELECTION_SYSTEM_PROMPT.includes('JSON'))
})

test('P1 三条新 prompt 非空且含 JSON 结构关键词', () => {
  assert.ok(REVIEW_SYSTEM_PROMPT.trim().length > 0)
  assert.ok(REVIEW_SYSTEM_PROMPT.includes('summary'))
  assert.ok(REVIEW_SYSTEM_PROMPT.includes('actions'))

  assert.ok(EXTRACT_KEY_POINTS_SYSTEM_PROMPT.trim().length > 0)
  assert.ok(EXTRACT_KEY_POINTS_SYSTEM_PROMPT.includes('point'))
  assert.ok(EXTRACT_KEY_POINTS_SYSTEM_PROMPT.includes('JSON'))

  assert.ok(ORGANIZE_TODOS_SYSTEM_PROMPT.trim().length > 0)
  assert.ok(ORGANIZE_TODOS_SYSTEM_PROMPT.includes('mergeGroups'))
  assert.ok(ORGANIZE_TODOS_SYSTEM_PROMPT.includes('ordered'))
  assert.ok(ORGANIZE_TODOS_SYSTEM_PROMPT.includes('JSON'))
})

test('分类 prompt 约束输出 JSON 且含预置分类指引', () => {
  assert.ok(CLASSIFY_SYSTEM_PROMPT.includes('JSON'))
  assert.ok(CLASSIFY_SYSTEM_PROMPT.includes('其他'))
})

test('关联 prompt 约束输出 JSON 数组', () => {
  assert.ok(RELATE_SYSTEM_PROMPT.includes('JSON'))
  assert.ok(RELATE_SYSTEM_PROMPT.includes('score'))
})

test('思维树 prompt 约束输出 5 维度 JSON', () => {
  assert.ok(MIND_TREE_SYSTEM_PROMPT.includes('JSON'))
  assert.ok(MIND_TREE_SYSTEM_PROMPT.includes('dimensions'))
  for (const key of ['concept', 'premise', 'feasibility', 'counter', 'action']) {
    assert.ok(MIND_TREE_SYSTEM_PROMPT.includes(key), `缺少维度 ${key}`)
  }
})
