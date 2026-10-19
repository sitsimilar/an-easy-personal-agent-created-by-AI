/**
 * 思维树林页面（/mindtree）：多棵思维树共存 + 树林组群 + AI 交叉关联。
 *
 * - 左：ForestSidebar（树/树林列表 + 归组管理）；
 * - 右：当前树编辑区（复用 MindTreeNodeView）+ CrossLinkPanel（交叉建议/确认/断开）；
 * - 数据持久化到 localStorage（personal-agent.mindforest.v1，debounce 400ms），
 *   legacy 单树（mindtree.v1）由 mindforest-store 一次性迁移。
 */
import { useEffect, useRef, useState } from 'react'
import { useTheme } from '@mui/material/styles'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  LinearProgress,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import UploadIcon from '@mui/icons-material/Upload'
import type {
  CrossPartner,
  MindForestStore,
  MindTree,
  MindTreeDimension,
  MindTreeNode,
} from '@shared/types/domain'
import { aiService } from '@/services/aiService'
import { friendlyError } from '@/lib/unwrap'
import PageHeader from '@/components/PageHeader'
import MindTreeNodeView from '@/components/mindtree/MindTreeNodeView'
import {
  DIMENSION_META,
  DIMENSION_ORDER,
  createNode,
  dimensionColor,
  fallbackDimensions,
} from '@/components/mindtree/dimensions'
import {
  addSuggestedCrossLinks,
  addTreeToForest,
  confirmCrossLink,
  createDebouncedSaver,
  createForest,
  createTree,
  crossPartnersOf,
  deleteForest,
  deleteTree,
  deserializeForestStore,
  ignoreCrossLink,
  loadForestStore,
  pruneNodeCrossLinks,
  removeTreeFromForest,
  renameForest,
  renameTree,
  saveForestStore,
  serializeForestStore,
  upsertTree,
} from '@/services/mindforest-store'
import ForestSidebar from '@/components/mindforest/ForestSidebar'
import CrossLinkPanel from '@/components/mindforest/CrossLinkPanel'

/** 不可变更新：命中 targetId 的节点应用 updater，未命中返回原引用。 */
function updateTree(
  root: MindTreeNode,
  targetId: string,
  updater: (node: MindTreeNode) => MindTreeNode,
): MindTreeNode {
  if (root.id === targetId) return updater(root)
  let changed = false
  const children = root.children.map((c) => {
    const next = updateTree(c, targetId, updater)
    if (next !== c) changed = true
    return next
  })
  return changed ? { ...root, children } : root
}

/** 不可变删除：从树中摘除 targetId 节点，未命中返回原引用。 */
function removeFromTree(node: MindTreeNode, targetId: string): MindTreeNode {
  let changed = false
  const children: MindTreeNode[] = []
  for (const c of node.children) {
    if (c.id === targetId) {
      changed = true
      continue
    }
    const next = removeFromTree(c, targetId)
    if (next !== c) changed = true
    children.push(next)
  }
  return changed ? { ...node, children } : node
}

/** 思维树林页面。 */
export default function MindTreePage() {
  const theme = useTheme()
  const [store, setStore] = useState<MindForestStore>(() => loadForestStore())
  const [activeTreeId, setActiveTreeId] = useState<string | null>(() => store.trees[0]?.id ?? null)
  const [activeForestId, setActiveForestId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [generating, setGenerating] = useState(false)
  const [crossGenerating, setCrossGenerating] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [nodeErrors, setNodeErrors] = useState<Record<string, string>>({})
  const lastTopicRef = useRef('')
  const storeRef = useRef(store)
  const saverRef = useRef(createDebouncedSaver(400))
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 卸载时 flush 一次，避免 debounce 未落盘的数据丢失
  useEffect(() => {
    return () => saveForestStore(storeRef.current)
  }, [])

  /** 当前树（用户选择优先，否则第一棵）。 */
  const activeTree: MindTree | null =
    store.trees.find((t) => t.id === activeTreeId) ?? store.trees[0] ?? null

  /** 当前树林。 */
  const activeForest = activeForestId ? store.forests.find((f) => f.id === activeForestId) ?? null : null

  /** 应用 store 变更：更新状态 + debounce 持久化 + 刷新 storeRef。 */
  const applyStore = (fn: (s: MindForestStore) => MindForestStore): void => {
    setStore((prev) => {
      const next = fn(prev)
      storeRef.current = next
      saverRef.current(next)
      return next
    })
  }

  /** 按 treeId 改树（异步流程中避免闭包过期）。 */
  const mutateTreeById = (treeId: string, updater: (tree: MindTree) => MindTree): void => {
    applyStore((s) => {
      const tree = s.trees.find((t) => t.id === treeId)
      if (!tree) return s
      return upsertTree(s, updater(tree))
    })
  }

  const clearNodeError = (id: string): void => {
    setNodeErrors((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  /** 由维度结果构建根的分支：维度节点（带维度 key）+ 其下问题节点。 */
  const buildBranches = (dimensions: MindTreeDimension[]): MindTreeNode[] =>
    dimensions.map((d) => {
      const dimNode = createNode(d.label, d.key)
      dimNode.children = d.questions.map((q) => createNode(q))
      return dimNode
    })

  /** 由维度结果摊平出思考点子节点（用于非根节点的延伸 / 重新生成）。 */
  const flattenQuestions = (dimensions: MindTreeDimension[]): MindTreeNode[] =>
    dimensions.flatMap((d) => d.questions.map((q) => createNode(q, d.key)))

  /** 新建树并生成根分支（AI 失败降级内置模板）。 */
  const generateRoot = async (topic: string): Promise<void> => {
    const t = topic.trim()
    if (!t || generating) return
    lastTopicRef.current = t
    setGenerating(true)
    setError('')
    setNotice('')
    // 先创建并插入树（稳定 id，避免流式 partial 每次都新建重复树）
    const tree = createTree(t)
    setActiveTreeId(tree.id)
    applyStore((s) => upsertTree(s, tree))
    const setChildren = (dims: MindTreeDimension[]): void => {
      applyStore((s) => {
        const cur = s.trees.find((x) => x.id === tree.id)
        if (!cur) return s
        return upsertTree(s, { ...cur, root: { ...cur.root, children: buildBranches(dims) } })
      })
    }
    try {
      const result = await aiService.generateMindTree(t, { onPartial: setChildren })
      setChildren(result.dimensions)
      setDraft('')
    } catch (err) {
      try {
        setChildren(fallbackDimensions(t))
        setNotice('AI 生成失败，已使用内置引导模板，可点击「重新生成」重试')
      } catch {
        setError(friendlyError(err))
      }
    } finally {
      setGenerating(false)
    }
  }

  /** 就当前节点继续深挖：AI 结果摊平为子节点追加（text 为可选的深挖方向）。 */
  const handleExtend = async (node: MindTreeNode, text: string): Promise<void> => {
    const tree = activeTree
    if (!tree) return
    const id = node.id
    clearNodeError(id)
    const baseChildren = node.children
    mutateTreeById(tree.id, (t) => ({
      ...t,
      root: updateTree(t.root, id, (n) => ({ ...n, loading: true })),
    }))
    try {
      const focus = text.trim() ? `\n深挖方向：${text.trim()}` : ''
      const result = await aiService.generateMindTree(`主题：${tree.name}\n思考点：${node.text}${focus}`, {
        onPartial: (dims) => {
          const additions = flattenQuestions(dims)
          mutateTreeById(tree.id, (t) => ({
            ...t,
            root: updateTree(t.root, id, (n) => ({ ...n, children: [...baseChildren, ...additions] })),
          }))
        },
      })
      const additions = flattenQuestions(result.dimensions)
      mutateTreeById(tree.id, (t) => ({
        ...t,
        root: updateTree(t.root, id, (n) => ({
          ...n,
          loading: false,
          children: [...baseChildren, ...additions],
        })),
      }))
    } catch (err) {
      mutateTreeById(tree.id, (t) => ({
        ...t,
        root: updateTree(t.root, id, (n) => ({ ...n, loading: false })),
      }))
      setNodeErrors((prev) => ({ ...prev, [id]: friendlyError(err) }))
    }
  }

  /** 重新生成子分支（替换 children）；根节点 = 重建 5 个维度分支。 */
  const handleRegenerate = async (node: MindTreeNode): Promise<void> => {
    const tree = activeTree
    if (!tree) return
    const id = node.id
    const isRoot = id === tree.root.id
    clearNodeError(id)
    mutateTreeById(tree.id, (t) => ({
      ...t,
      root: updateTree(t.root, id, (n) => ({ ...n, loading: true })),
    }))
    try {
      const input = isRoot ? tree.name : `主题：${tree.name}\n思考点：${node.text}`
      const result = await aiService.generateMindTree(input, {
        onPartial: (dims) => {
          mutateTreeById(tree.id, (t) => ({
            ...t,
            root: updateTree(t.root, id, (n) => ({
              ...n,
              children: isRoot ? buildBranches(dims) : flattenQuestions(dims),
            })),
          }))
        },
      })
      mutateTreeById(tree.id, (t) => ({
        ...t,
        root: updateTree(t.root, id, (n) => ({
          ...n,
          loading: false,
          children: isRoot ? buildBranches(result.dimensions) : flattenQuestions(result.dimensions),
        })),
      }))
    } catch (err) {
      mutateTreeById(tree.id, (t) => ({
        ...t,
        root: updateTree(t.root, id, (n) => ({ ...n, loading: false })),
      }))
      setNodeErrors((prev) => ({ ...prev, [id]: friendlyError(err) }))
    }
  }

  /** 直接追加一个手输子节点（不调 AI）。 */
  const handleAdd = (node: MindTreeNode, text: string): void => {
    const tree = activeTree
    const t = text.trim()
    if (!tree || !t) return
    mutateTreeById(tree.id, (tr) => ({
      ...tr,
      root: updateTree(tr.root, node.id, (n) => ({ ...n, children: [...n.children, createNode(t)] })),
    }))
  }

  /** 删除节点；根节点 = 删除整棵树。删除节点时级联清理其交叉链接。 */
  const handleDelete = (node: MindTreeNode): void => {
    const tree = activeTree
    if (!tree) return
    if (node.id === tree.root.id) {
      handleDeleteTree(tree.id)
      return
    }
    clearNodeError(node.id)
    applyStore((s) => {
      const tr = s.trees.find((t) => t.id === tree.id)
      if (!tr) return s
      const next = upsertTree(s, { ...tr, root: removeFromTree(tr.root, node.id) })
      return pruneNodeCrossLinks(next, tree.id, node.id)
    })
  }

  /** 折叠 / 展开。 */
  const handleToggle = (node: MindTreeNode): void => {
    const tree = activeTree
    if (!tree) return
    mutateTreeById(tree.id, (t) => ({
      ...t,
      root: updateTree(t.root, node.id, (n) => ({ ...n, collapsed: !n.collapsed })),
    }))
  }

  /** 节点备注变更（随树持久化）。 */
  const handleNoteChange = (node: MindTreeNode, note: string): void => {
    const tree = activeTree
    if (!tree) return
    mutateTreeById(tree.id, (t) => ({
      ...t,
      root: updateTree(t.root, node.id, (n) => ({ ...n, note })),
    }))
  }

  /** 当前节点交叉伙伴（供 MindTreeNodeView 递归解析）。 */
  const partnersOf = (nodeId: string): CrossPartner[] => {
    const tree = activeTree
    if (!tree || !activeForestId) return []
    return crossPartnersOf(store, activeForestId, tree.id, nodeId)
  }

  /** 生成交叉建议。 */
  const handleGenerateCross = async (): Promise<void> => {
    const forest = activeForest
    if (!forest || crossGenerating) return
    const trees = store.trees.filter((t) => forest.treeIds.includes(t.id))
    if (trees.length < 2) return
    setCrossGenerating(true)
    setError('')
    try {
      const sugg = await aiService.suggestCrossLinks({ forestId: forest.id, trees })
      applyStore((s) => addSuggestedCrossLinks(s, forest.id, sugg))
      setNotice(`已生成 ${sugg.length} 条交叉建议，请确认后生效`)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setCrossGenerating(false)
    }
  }

  /** 树操作。 */
  const handleCreateTree = (name: string): void => {
    const tree = createTree(name)
    applyStore((s) => upsertTree(s, tree))
    setActiveTreeId(tree.id)
  }
  const handleRenameTree = (id: string, name: string): void => applyStore((s) => renameTree(s, id, name))
  const handleDeleteTree = (treeId: string): void => {
    applyStore((s) => deleteTree(s, treeId))
    setNodeErrors({})
  }

  /** 树林操作。 */
  const handleCreateForest = (name: string, treeIds: string[]): void => {
    const forest = createForest(name, treeIds)
    applyStore((s) => ({ ...s, forests: [...s.forests, forest] }))
    setActiveForestId(forest.id)
  }
  const handleRenameForest = (id: string, name: string): void => applyStore((s) => renameForest(s, id, name))
  const handleDeleteForest = (id: string): void => {
    applyStore((s) => deleteForest(s, id))
    setActiveForestId((prev) => (prev === id ? null : prev))
  }
  const handleAddTreeToForest = (forestId: string, treeId: string): void =>
    applyStore((s) => addTreeToForest(s, forestId, treeId))
  const handleRemoveTreeFromForest = (forestId: string, treeId: string): void =>
    applyStore((s) => removeTreeFromForest(s, forestId, treeId))

  /** 导出思维树林为 JSON 文件（跨设备迁移 / 备份）。 */
  const handleExport = (): void => {
    const json = serializeForestStore(store)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `personal-agent-mindforest-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  /** 选择导入文件后读取并解析。 */
  const handleImportFile = (file: File): void => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : ''
      const next = deserializeForestStore(raw)
      if (!next) {
        setError('导入失败：文件格式不正确或数据不完整，请检查后重试')
        return
      }
      applyStore(() => next)
      setActiveTreeId(next.trees[0]?.id ?? null)
      setNotice('导入成功，思维树林数据已更新')
    }
    reader.onerror = () => setError('导入失败：无法读取文件')
    reader.readAsText(file)
  }

  /** 页面级错误重试：优先用上次主题重新生成。 */
  const handleRetry = (): void => {
    const t = draft.trim() || lastTopicRef.current || activeTree?.name || ''
    if (t) {
      setDraft(t)
      void generateRoot(t)
    } else {
      setError('')
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1280, mx: 'auto' }}>
      <PageHeader title="思维树" subtitle="把一个想法展开成思考树，多棵树可归入树林并交叉关联" />

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={handleRetry}>
              重试
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
        <Box sx={{ width: { xs: '100%', md: 280 }, flexShrink: 0 }}>
          <ForestSidebar
            store={store}
            activeTreeId={activeTree?.id ?? null}
            activeForestId={activeForestId}
            onSelectTree={setActiveTreeId}
            onSelectForest={setActiveForestId}
            onCreateTree={handleCreateTree}
            onRenameTree={handleRenameTree}
            onDeleteTree={handleDeleteTree}
            onCreateForest={handleCreateForest}
            onRenameForest={handleRenameForest}
            onDeleteForest={handleDeleteForest}
            onAddTreeToForest={handleAddTreeToForest}
            onRemoveTreeFromForest={handleRemoveTreeFromForest}
          />

          {/* 导出 / 导入：跨设备迁移与备份（思维树仅存本地，需手动搬运） */}
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Tooltip title="导出思维树林为 JSON 文件，用于备份或迁移到其他设备">
              <Button
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={handleExport}
                fullWidth
              >
                导出 JSON
              </Button>
            </Tooltip>
            <Tooltip title="从 JSON 文件导入思维树林（会覆盖当前数据）">
              <Button
                size="small"
                variant="outlined"
                startIcon={<UploadIcon />}
                onClick={() => fileInputRef.current?.click()}
                fullWidth
              >
                导入 JSON
              </Button>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleImportFile(file)
                e.target.value = ''
              }}
            />
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          {notice && (
            <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice('')}>
              {notice}
            </Alert>
          )}

          {/* 维度图例：五维度主题色说明 */}
          {activeTree && (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', gap: 0.75 }}>
              {DIMENSION_ORDER.map((key) => (
                <Stack key={key} direction="row" spacing={0.5} alignItems="center">
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: dimensionColor(key, theme),
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {DIMENSION_META[key].label}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}

          {!activeTree ? (
            /* 空态：主题输入卡片 */
            <Card variant="outlined" sx={{ maxWidth: 640, mx: 'auto', mt: 4 }}>
              <CardContent>
                <Stack spacing={2}>
                  <TextField
                    fullWidth
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void generateRoot(draft)
                    }}
                    placeholder="输入一句话主题或待解决的问题，如：要不要把副产品做成独立产品？"
                  />
                  <Button
                    variant="contained"
                    disabled={!draft.trim() || generating}
                    onClick={() => void generateRoot(draft)}
                    startIcon={generating ? <CircularProgress size={14} color="inherit" /> : undefined}
                  >
                    {generating ? '生成中…' : '生成思维树'}
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    将按 核心概念 / 前提与假设 / 可行性与风险 / 反面观点 / 下一步行动 五个维度展开
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* 重新生成整棵树时，旧树照常显示，顶部叠加载条 */}
              {generating && <LinearProgress sx={{ mb: 2 }} />}

              {/* 根卡片（子节点由下方树杈分支渲染） */}
              <MindTreeNodeView
                node={activeTree.root}
                depth={0}
                topic={activeTree.name}
                errors={nodeErrors}
                onExtend={handleExtend}
                onRegenerate={handleRegenerate}
                onAdd={handleAdd}
                onDelete={handleDelete}
                onToggle={handleToggle}
                onNoteChange={handleNoteChange}
                getCrossPartners={partnersOf}
                hideChildren
              />

              {/* 5 个维度分支：纵向树杈（左侧竖直主干 + 每个维度 └ 短横枝连入） */}
              <Box sx={{ position: 'relative', mt: 1.5, ml: 2 }}>
                {/* 竖直主干：从根卡片向下延伸 */}
                <Box
                  sx={{
                    position: 'absolute',
                    left: 0,
                    top: -8,
                    bottom: 16,
                    borderLeft: '2px solid',
                    borderLeftColor: theme.palette.divider,
                    opacity: 0.6,
                  }}
                />
                <Stack spacing={2} sx={{ pl: 2 }}>
                  {activeTree.root.children.map((dimNode) => (
                    <Box key={dimNode.id} sx={{ position: 'relative' }}>
                      {/* └ 短横枝：从主干连到维度卡左缘（维度色） */}
                      <Box
                        sx={{
                          position: 'absolute',
                          left: -16,
                          top: 22,
                          width: 16,
                          borderTop: '2px solid',
                          borderTopColor: dimensionColor(dimNode.dimension ?? '', theme),
                          opacity: 0.8,
                        }}
                      />
                      <MindTreeNodeView
                        node={dimNode}
                        depth={1}
                        topic={activeTree.name}
                        errors={nodeErrors}
                        onExtend={handleExtend}
                        onRegenerate={handleRegenerate}
                        onAdd={handleAdd}
                        onDelete={handleDelete}
                        onToggle={handleToggle}
                        onNoteChange={handleNoteChange}
                        getCrossPartners={partnersOf}
                        inheritedColor={dimensionColor(dimNode.dimension ?? '', theme)}
                      />
                    </Box>
                  ))}
                </Stack>
              </Box>
            </>
          )}

          {/* 交叉关联面板（≥2 棵树才可能组群） */}
          {store.trees.length >= 2 && (
            <Box sx={{ mt: 2 }}>
              <CrossLinkPanel
                forestId={activeForestId}
                store={store}
                generating={crossGenerating}
                onGenerate={handleGenerateCross}
                onConfirm={(id) => applyStore((s) => confirmCrossLink(s, id))}
                onIgnore={(id) => applyStore((s) => ignoreCrossLink(s, id))}
              />
            </Box>
          )}
        </Box>
      </Stack>
    </Box>
  )
}
