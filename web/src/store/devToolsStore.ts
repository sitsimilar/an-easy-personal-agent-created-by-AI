/**
 * 开发者工具箱持久化 store。
 *
 * 保存「读取选区」分析结果与「代码生成」结果到 localStorage，
 * 使切换工具 / 离开工具箱页再返回时结果不丢失（支持后台完成后恢复）。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CppCheatEntry, SelectionAnalysisResult } from '@shared/types/domain'

/** 代码生成结果（需求 + 代码 + 关联知识点）。 */
export interface CodeGenResult {
  requirement: string
  code: string
  points: CppCheatEntry[]
}

interface DevToolsState {
  /** 读取选区分析结果。 */
  selectionResult: SelectionAnalysisResult | null
  /** 代码生成结果。 */
  codeGenResult: CodeGenResult | null
  setSelectionResult: (r: SelectionAnalysisResult | null) => void
  setCodeGenResult: (r: CodeGenResult | null) => void
}

export const useDevToolsStore = create<DevToolsState>()(
  persist(
    (set) => ({
      selectionResult: null,
      codeGenResult: null,
      setSelectionResult: (r) => set({ selectionResult: r }),
      setCodeGenResult: (r) => set({ codeGenResult: r }),
    }),
    { name: 'personal-agent.devtools.v1' },
  ),
)
