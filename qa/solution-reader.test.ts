/**
 * desktop/src/main/solution-reader.ts 单元测试
 * 覆盖：.sln 解析、.csproj 源码项提取、扩展名白名单、目录跳过、大小限制、增量 hash。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { readSolution } from '../desktop/src/main/solution-reader'

/** 建立临时解决方案目录，返回其路径与各文件绝对路径。 */
function makeSolution(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'qa-sln-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf-8')
  }
  return dir
}

const SLN_TEMPLATE = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Proj1", "Proj1\\Proj1.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Proj2", "Proj2\\Proj2.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
Global
EndGlobal
`

test('解析 .sln 得到解决方案名与项目名列表', async () => {
  const dir = makeSolution({
    'Test.sln': SLN_TEMPLATE,
    'Proj1/Proj1.csproj': '<Project><ItemGroup><Compile Include="Program.cs" /></ItemGroup></Project>',
    'Proj1/Program.cs': 'class P {}',
    'Proj2/Proj2.csproj': '<Project><ItemGroup><Compile Include="Service.ts" /></ItemGroup></Project>',
    'Proj2/Service.ts': 'export const a = 1',
  })
  const result = await readSolution(join(dir, 'Test.sln'))
  assert.equal(result.solutionName, 'Test')
  assert.deepEqual(result.projectNames.sort(), ['Proj1', 'Proj2'])
  rmSync(dir, { recursive: true, force: true })
})

test('提取 .csproj 中的白名单源码项（含子目录）', async () => {
  const dir = makeSolution({
    'Test.sln': SLN_TEMPLATE,
    'Proj1/Proj1.csproj':
      '<Project><ItemGroup>' +
      '<Compile Include="Program.cs" />' +
      '<Compile Include="Models\\User.cs" />' +
      '</ItemGroup></Project>',
    'Proj1/Program.cs': 'class P {}',
    'Proj1/Models/User.cs': 'class U {}',
    'Proj2/Proj2.csproj': '<Project />',
  })
  const result = await readSolution(join(dir, 'Test.sln'))
  const rels = result.changedFiles.map((f) => f.relativePath).sort()
  assert.deepEqual(rels, ['Proj1/Models/User.cs', 'Proj1/Program.cs'])
  rmSync(dir, { recursive: true, force: true })
})

test('扩展名白名单过滤：非白名单文件不入结果', async () => {
  const dir = makeSolution({
    'Test.sln': SLN_TEMPLATE,
    'Proj1/Proj1.csproj':
      '<Project><ItemGroup>' +
      '<Compile Include="Program.cs" />' +
      '<None Include="notes.txt" />' +
      '<Content Include="readme.md" />' +
      '</ItemGroup></Project>',
    'Proj1/Program.cs': 'class P {}',
    'Proj1/notes.txt': 'hello',
    'Proj1/readme.md': '# hi',
    'Proj2/Proj2.csproj': '<Project />',
  })
  const result = await readSolution(join(dir, 'Test.sln'))
  const rels = result.changedFiles.map((f) => f.relativePath)
  assert.deepEqual(rels, ['Proj1/Program.cs'])
  rmSync(dir, { recursive: true, force: true })
})

test('目录跳过：bin/obj/node_modules 等目录被排除', async () => {
  const dir = makeSolution({
    'Test.sln': SLN_TEMPLATE,
    'Proj1/Proj1.csproj':
      '<Project><ItemGroup>' +
      '<Compile Include="Program.cs" />' +
      '<Compile Include="bin\\Generated.cs" />' +
      '<Compile Include="obj\\Temp.cs" />' +
      '</ItemGroup></Project>',
    'Proj1/Program.cs': 'class P {}',
    'Proj1/bin/Generated.cs': 'class G {}',
    'Proj1/obj/Temp.cs': 'class T {}',
    'Proj2/Proj2.csproj': '<Project />',
  })
  const result = await readSolution(join(dir, 'Test.sln'))
  const rels = result.changedFiles.map((f) => f.relativePath)
  assert.deepEqual(rels, ['Proj1/Program.cs'])
  assert.ok(!rels.some((r) => /(bin|obj)\//.test(r)))
  rmSync(dir, { recursive: true, force: true })
})

test('单文件大小限制：超过 200KB 的文件被跳过', async () => {
  const big = 'x'.repeat(210 * 1024) // 210KB > 200KB
  const dir = makeSolution({
    'Test.sln': SLN_TEMPLATE,
    'Proj1/Proj1.csproj':
      '<Project><ItemGroup>' +
      '<Compile Include="Program.cs" />' +
      '<Compile Include="Big.cs" />' +
      '</ItemGroup></Project>',
    'Proj1/Program.cs': 'class P {}',
    'Proj1/Big.cs': big,
    'Proj2/Proj2.csproj': '<Project />',
  })
  const result = await readSolution(join(dir, 'Test.sln'))
  const rels = result.changedFiles.map((f) => f.relativePath)
  assert.deepEqual(rels, ['Proj1/Program.cs'])
  // 大文件不进入 hashes 结果
  assert.ok(!('Proj1/Big.cs' in result.hashes))
  rmSync(dir, { recursive: true, force: true })
})

test('总量大小限制：总字节数被截断（不无限读取）', async () => {
  // 15 个 ~190KB 的源文件，总远超 2MB；单文件均 < 200KB
  const files: Record<string, string> = {
    'Test.sln': SLN_TEMPLATE,
    'Proj1/Proj1.csproj': '<Project><ItemGroup><Compile Include="F0.cs" /></ItemGroup></Project>',
    'Proj2/Proj2.csproj': '<Project />',
  }
  const chunk = 'y'.repeat(190 * 1024)
  for (let i = 0; i < 15; i++) {
    files[`Proj1/F${i}.cs`] = chunk
    if (i > 0) {
      files['Proj1/Proj1.csproj'] =
        `<Project><ItemGroup>${Array.from({ length: i + 1 }, (_, k) => `<Compile Include="F${k}.cs" />`).join('')}</ItemGroup></Project>`
    }
  }
  const dir = makeSolution(files)
  const result = await readSolution(join(dir, 'Test.sln'))
  const total = result.changedFiles.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf-8'), 0)
  // 有上限：不应把所有 15 个文件都纳入（15 * 190KB ≈ 2.85MB > 2MB）
  assert.ok(result.changedFiles.length < 15, '应因总量限制截断文件列表')
  // 上限为 2MB + 单文件上限（软性越界最多一个文件）
  assert.ok(total <= 2 * 1024 * 1024 + 200 * 1024, `总字节数越界：${total}`)
  rmSync(dir, { recursive: true, force: true })
})

test('增量：与 prevHashes 一致的未变更文件不再推入 changedFiles', async () => {
  const dir = makeSolution({
    'Test.sln': SLN_TEMPLATE,
    'Proj1/Proj1.csproj':
      '<Project><ItemGroup>' +
      '<Compile Include="A.cs" />' +
      '<Compile Include="B.cs" />' +
      '</ItemGroup></Project>',
    'Proj1/A.cs': 'class A {}',
    'Proj1/B.cs': 'class B {}',
    'Proj2/Proj2.csproj': '<Project />',
  })
  const hashA = createHash('sha256').update('class A {}').digest('hex')

  const result = await readSolution(join(dir, 'Test.sln'), { 'Proj1/A.cs': hashA })
  const rels = result.changedFiles.map((f) => f.relativePath).sort()
  assert.deepEqual(rels, ['Proj1/B.cs'])
  // 但 A.cs 仍保留在 hashes 全量结果中
  assert.equal(result.hashes['Proj1/A.cs'], hashA)
  rmSync(dir, { recursive: true, force: true })
})

test('空 .sln 回退为按扩展名递归收集（跳过 bin/node_modules）', async () => {
  const emptySln =
    'Microsoft Visual Studio Solution File, Format Version 12.00\nGlobal\nEndGlobal\n'
  const dir = makeSolution({
    'Test.sln': emptySln,
    'Program.cs': 'class P {}',
    'Sub/Util.ts': 'export const u = 1',
    'bin/Skip.cs': 'class S {}',
    'node_modules/lib.ts': 'export const l = 1',
  })
  const result = await readSolution(join(dir, 'Test.sln'))
  const rels = result.changedFiles.map((f) => f.relativePath).sort()
  assert.ok(rels.includes('Program.cs'))
  assert.ok(rels.includes('Sub/Util.ts'))
  assert.ok(!rels.some((r) => /(bin|node_modules)\//.test(r)), `出现被跳过目录文件：${rels}`)
  rmSync(dir, { recursive: true, force: true })
})
