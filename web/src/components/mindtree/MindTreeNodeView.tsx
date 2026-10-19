/**
 * 思维树节点（递归组件）：根卡片 / 维度分支 / 思考点通用。
 *
 * - depth=0：根卡片（主题大字 + 重新生成全部分支 / 删除整棵树）；
 * - depth≥1：左侧 3px 维度色竖线 + 随深度缩进 + 子节点区虚线导引线；
 * - 每个卡片底部嵌可编辑文本备注区。
 */
import { useState } from 'react'
import { useTheme } from '@mui/material/styles'
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  IconButton,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import LinkIcon from '@mui/icons-material/Link'
import PostAddIcon from '@mui/icons-material/PostAdd'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { CrossPartner, MindTreeNode } from '@shared/types/domain'
import { dimensionColor, dimensionLabel } from './dimensions'

export interface MindTreeNodeViewProps {
  node: MindTreeNode
  /** 根为 0，每深一级 +1。 */
  depth: number
  /** 整树主题（供深挖时构造 LLM 输入）。 */
  topic: string
  /** 就当前节点继续深挖（text 为用户补充的深挖方向，可为空）。 */
  onExtend: (node: MindTreeNode, text: string) => void
  /** 重新生成本节点的子分支（替换 children）。 */
  onRegenerate: (node: MindTreeNode) => void
  /** 直接追加一个手输子节点。 */
  onAdd: (node: MindTreeNode, text: string) => void
  /** 删除当前节点（根节点 = 删除整棵树）。 */
  onDelete: (node: MindTreeNode) => void
  /** 折叠 / 展开。 */
  onToggle: (node: MindTreeNode) => void
  /** 手写笔迹变更。 */
  onNoteChange: (node: MindTreeNode, note: string) => void
  /** 页面级节点错误 map（nodeId → 失败文案），本节点取自身条目展示。 */
  errors?: Record<string, string>
  /** 为 true 时不渲染子节点（页面把子节点渲染到别处，如维度分支 Grid）。 */
  hideChildren?: boolean
  /** 交叉伙伴列表；非空即交叉节点，渲染徽标 + 伙伴列表。 */
  crossPartners?: CrossPartner[]
  /** 交叉伙伴点击回调（跳转到对应树并高亮；P2 可空实现）。 */
  onCrossPartnerClick?: (partner: CrossPartner) => void
  /** 递归解析子节点交叉伙伴（页面按 nodeId 派生传入；与 crossPartners 二选一或同时给）。 */
  getCrossPartners?: (nodeId: string) => CrossPartner[]
  /** 继承的父节点连线色（思考点无维度时沿用父维度色，实现同维度子树同色）。 */
  inheritedColor?: string
}

type EditingKind = 'extend' | 'add' | null

/** 思维树节点视图。 */
export default function MindTreeNodeView({
  node,
  depth,
  topic,
  onExtend,
  onRegenerate,
  onAdd,
  onDelete,
  onToggle,
  onNoteChange,
  errors,
  hideChildren = false,
  crossPartners,
  onCrossPartnerClick,
  getCrossPartners,
  inheritedColor,
}: MindTreeNodeViewProps) {
  const theme = useTheme()
  const [editing, setEditing] = useState<EditingKind>(null)
  const [draft, setDraft] = useState('')
  const [crossAnchor, setCrossAnchor] = useState<HTMLElement | null>(null)

  const isRoot = depth === 0
  const hasChildren = node.children.length > 0
  const nodeError = errors?.[node.id]
  // 连线/左边线/维度 Chip 统一取色：节点自带维度用维度色，否则继承父维度色，再回落 divider
  const lineColor = node.dimension ? dimensionColor(node.dimension, theme) : (inheritedColor ?? theme.palette.divider)
  const partners = crossPartners ?? getCrossPartners?.(node.id) ?? []
  const isCross = partners.length > 0

  const submitEditing = () => {
    const text = draft.trim()
    if (!text) {
      setEditing(null)
      return
    }
    if (editing === 'extend') onExtend(node, text)
    if (editing === 'add') onAdd(node, text)
    setDraft('')
    setEditing(null)
  }

  const cancelEditing = () => {
    setDraft('')
    setEditing(null)
  }

  return (
    <Box sx={{ pl: isRoot ? 0 : 1.5 }}>
      <Card
        variant="outlined"
        sx={{
          p: isRoot ? 2 : 1.5,
          // 交叉节点加浅色虚线边框强调（维度色竖线保留：borderLeft 声明在后覆盖左侧）
          border: isCross ? '1px dashed' : undefined,
          borderColor: isCross ? theme.palette.primary.light : undefined,
          borderLeft: isRoot ? undefined : '3px solid',
          borderLeftColor: isRoot ? undefined : lineColor,
          opacity: node.loading ? 0.75 : 1,
          transition: 'box-shadow .15s ease',
          '&:hover': { boxShadow: 2 },
        }}
      >
        {/* 节点行：维度 Chip + 文本 + 操作按钮 */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: node.loading || nodeError ? 1 : 0 }}>
          {node.dimension && (
            <Chip
              size="small"
              label={dimensionLabel(node.dimension)}
              sx={{
                fontSize: 10,
                height: 20,
                color: lineColor,
                borderColor: lineColor,
                bgcolor: 'transparent',
              }}
              variant="outlined"
            />
          )}
          {isCross && (
            <>
              <Tooltip title={`交叉节点，${partners.length} 个跨树伙伴`}>
                <Chip
                  size="small"
                  icon={<LinkIcon sx={{ fontSize: 13 }} />}
                  label={`${partners.length}`}
                  onClick={(e) => setCrossAnchor(e.currentTarget as HTMLElement)}
                  sx={{
                    fontSize: 10,
                    height: 20,
                    color: 'primary.main',
                    borderColor: 'primary.main',
                    bgcolor: 'transparent',
                    cursor: 'pointer',
                  }}
                  variant="outlined"
                />
              </Tooltip>
              <Popover
                open={Boolean(crossAnchor)}
                anchorEl={crossAnchor}
                onClose={() => setCrossAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
              >
                <Box sx={{ p: 1.5, maxWidth: 340 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    交叉节点 · {partners.length} 个跨树伙伴
                  </Typography>
                  <Stack spacing={0.5}>
                    {partners.map((p, i) => (
                      <Box
                        key={`${p.treeId}-${p.nodeId}-${i}`}
                        sx={{
                          p: 0.5,
                          borderRadius: 0.5,
                          bgcolor: 'action.hover',
                          cursor: onCrossPartnerClick ? 'pointer' : 'default',
                        }}
                        onClick={() => {
                          if (onCrossPartnerClick) {
                            setCrossAnchor(null)
                            onCrossPartnerClick(p)
                          }
                        }}
                      >
                        <Typography variant="body2" fontWeight={600}>
                          {p.treeName} · {p.nodeText}
                        </Typography>
                        {p.reason && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {p.reason}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Stack>
                </Box>
              </Popover>
            </>
          )}
          <Typography
            variant={isRoot ? 'subtitle1' : 'body2'}
            fontWeight={isRoot ? 700 : 600}
            sx={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}
          >
            {node.text}
          </Typography>
          {hasChildren && (
            <Typography variant="caption" color="text.secondary" sx={{ flex: 'none' }}>
              {node.children.length} 个思考点
            </Typography>
          )}

          {isRoot ? (
            <>
              <Tooltip title="添加一个思考点">
                <IconButton
                  size="small"
                  aria-label="添加一个思考点"
                  onClick={() => {
                    setDraft('')
                    setEditing((v) => (v === 'add' ? null : 'add'))
                  }}
                  disabled={node.loading}
                >
                  <PostAddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={() => onRegenerate(node)}
                disabled={node.loading}
              >
                重新生成全部分支
              </Button>
              <Button
                size="small"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => onDelete(node)}
                disabled={node.loading}
              >
                删除整棵树
              </Button>
            </>
          ) : (
            <Stack direction="row" spacing={0.25} sx={{ flex: 'none' }}>
              {hasChildren && (
                <Tooltip title={node.collapsed ? '展开' : '折叠'}>
                  <IconButton
                    size="small"
                    aria-label={node.collapsed ? '展开' : '折叠'}
                    onClick={() => onToggle(node)}
                    disabled={node.loading}
                  >
                    {node.collapsed ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title="就这一点继续深挖">
                <IconButton
                  size="small"
                  aria-label="就这一点继续深挖"
                  onClick={() => {
                    setDraft('')
                    setEditing((v) => (v === 'extend' ? null : 'extend'))
                  }}
                  disabled={node.loading}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="添加一个思考点">
                <IconButton
                  size="small"
                  aria-label="添加一个思考点"
                  onClick={() => {
                    setDraft('')
                    setEditing((v) => (v === 'add' ? null : 'add'))
                  }}
                  disabled={node.loading}
                >
                  <PostAddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {hasChildren && (
                <Tooltip title="重新生成子分支">
                  <IconButton
                    size="small"
                    aria-label="重新生成子分支"
                    onClick={() => onRegenerate(node)}
                    disabled={node.loading}
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title="删除此节点">
                <IconButton
                  size="small"
                  aria-label="删除此节点"
                  onClick={() => onDelete(node)}
                  disabled={node.loading}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          )}
        </Stack>

        {/* 生成中 */}
        {node.loading && (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">
              生成中…
            </Typography>
          </Stack>
        )}

        {/* 生成失败：错误文案 + 重试 */}
        {nodeError && !node.loading && (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="caption" color="error" sx={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
              {nodeError}
            </Typography>
            <Button size="small" onClick={() => onRegenerate(node)}>
              重试
            </Button>
          </Stack>
        )}

        {/* 内联输入：深挖 / 新增子节点 */}
        {editing && (
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <TextField
              size="small"
              fullWidth
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitEditing()
                if (e.key === 'Escape') cancelEditing()
              }}
              placeholder={editing === 'extend' ? '就这一点继续深挖…' : '添加一个思考点…'}
            />
            <Button size="small" variant="contained" onClick={submitEditing} disabled={!draft.trim()}>
              确定
            </Button>
            <Button size="small" onClick={cancelEditing}>
              取消
            </Button>
          </Stack>
        )}

        {/* 节点备注（可编辑文本区） */}
        <Box sx={{ mt: 1 }}>
          <TextField
            size="small"
            fullWidth
            multiline
            minRows={2}
            maxRows={6}
            label="备注"
            placeholder="为这个思考点添加备注…"
            value={node.note ?? ''}
            onChange={(e) => onNoteChange(node, e.target.value)}
            disabled={node.loading}
          />
        </Box>

        {/* 子节点递归渲染（collapsed 时隐藏）：树杈连线（竖直轨道 + └ 短横枝） */}
        {!hideChildren && hasChildren && !node.collapsed && (
          <Box sx={{ position: 'relative', mt: 1, ml: 1 }}>
            {/* 竖直轨道线：从本节点向下延伸，继承维度色 */}
            <Box
              sx={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 16,
                borderLeft: '1.5px solid',
                borderLeftColor: lineColor,
                opacity: 0.6,
              }}
            />
            <Stack spacing={1} sx={{ pl: 2 }}>
              {node.children.map((child) => (
                <Box key={child.id} sx={{ position: 'relative' }}>
                  {/* └ 短横枝：从竖直轨道连到子卡片左缘 */}
                  <Box
                    sx={{
                      position: 'absolute',
                      left: -16,
                      top: 18,
                      width: 16,
                      borderTop: '1.5px solid',
                      borderTopColor: lineColor,
                      opacity: 0.6,
                    }}
                  />
                  <MindTreeNodeView
                    node={child}
                    depth={depth + 1}
                    topic={topic}
                    errors={errors}
                    onExtend={onExtend}
                    onRegenerate={onRegenerate}
                    onAdd={onAdd}
                    onDelete={onDelete}
                    onToggle={onToggle}
                    onNoteChange={onNoteChange}
                    crossPartners={getCrossPartners?.(child.id)}
                    getCrossPartners={getCrossPartners}
                    onCrossPartnerClick={onCrossPartnerClick}
                    inheritedColor={lineColor}
                  />
                </Box>
              ))}
            </Stack>
          </Box>
        )}
      </Card>
    </Box>
  )
}
