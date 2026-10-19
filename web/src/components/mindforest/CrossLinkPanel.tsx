/**
 * 交叉关联面板：当前树林的 AI 建议（suggested）+ 已确认（confirmed）列表。
 *
 * - suggested：待确认，不显示交叉徽标；可「确认」/「忽略」；
 * - confirmed：已生效，节点显示交叉徽标；可「断开」。
 */
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import LinkIcon from '@mui/icons-material/Link'
import type { CrossLink, CrossNodeRef, MindForestStore, MindTreeNode } from '@shared/types/domain'

export interface CrossLinkPanelProps {
  forestId: string | null
  store: MindForestStore
  /** AI 建议生成中。 */
  generating: boolean
  onGenerate: () => void
  onConfirm: (linkId: string) => void
  onIgnore: (linkId: string) => void
}

/** 前序查找节点文本。 */
function findNode(root: MindTreeNode, nodeId: string): MindTreeNode | null {
  if (root.id === nodeId) return root
  for (const child of root.children) {
    const hit = findNode(child, nodeId)
    if (hit) return hit
  }
  return null
}

/** 交叉端点 → 「树名 · 节点文本」。 */
function refLabel(store: MindForestStore, ref: CrossNodeRef): string {
  const tree = store.trees.find((t) => t.id === ref.treeId)
  if (!tree) return '(树已删除)'
  const node = findNode(tree.root, ref.nodeId)
  if (!node) return '(节点已删除)'
  return `${tree.name} · ${node.text}`
}

/** 单条交叉链接行。 */
function LinkRow({
  link,
  store,
  onConfirm,
  onIgnore,
}: {
  link: CrossLink
  store: MindForestStore
  onConfirm?: (id: string) => void
  onIgnore?: (id: string) => void
}) {
  return (
    <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.25 }}>
        <LinkIcon sx={{ fontSize: 14, color: 'primary.main' }} />
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
          {refLabel(store, link.a)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          ↔
        </Typography>
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
          {refLabel(store, link.b)}
        </Typography>
      </Stack>
      {link.reason && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {link.reason}
        </Typography>
      )}
      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
        {onConfirm && (
          <Button size="small" variant="contained" startIcon={<CheckIcon />} onClick={() => onConfirm(link.id)}>
            确认
          </Button>
        )}
        {onIgnore && (
          <Button size="small" color="inherit" startIcon={<CloseIcon />} onClick={() => onIgnore(link.id)}>
            {onConfirm ? '忽略' : '断开'}
          </Button>
        )}
      </Stack>
    </Box>
  )
}

/** 交叉关联面板。 */
export default function CrossLinkPanel({
  forestId,
  store,
  generating,
  onGenerate,
  onConfirm,
  onIgnore,
}: CrossLinkPanelProps) {
  const forest = forestId ? store.forests.find((f) => f.id === forestId) : null

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <AutoAwesomeIcon fontSize="small" />
          交叉关联
        </Typography>

        {!forest ? (
          <Typography variant="body2" color="text.secondary">
            请先在左侧选择或创建一个树林，再生成跨树交叉建议。
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {forest.treeIds.length < 2 ? (
              <Typography variant="body2" color="text.secondary">
                该树林需至少 2 棵树才能生成交叉建议（当前 {forest.treeIds.length} 棵）。
              </Typography>
            ) : (
              <Button
                size="small"
                variant="contained"
                startIcon={generating ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeIcon />}
                onClick={onGenerate}
                disabled={generating}
              >
                {generating ? '生成中…' : '生成交叉建议'}
              </Button>
            )}

            {(() => {
              const links = store.crossLinks.filter((l) => l.forestId === forest.id)
              const suggested = links.filter((l) => l.status === 'suggested')
              const confirmed = links.filter((l) => l.status === 'confirmed')
              return (
                <>
                  {suggested.length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        待确认建议（{suggested.length}）
                      </Typography>
                      <Stack spacing={0.75}>
                        {suggested.map((l) => (
                          <LinkRow key={l.id} link={l} store={store} onConfirm={onConfirm} onIgnore={onIgnore} />
                        ))}
                      </Stack>
                    </Box>
                  )}
                  {confirmed.length > 0 && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        已确认交叉（{confirmed.length}）
                      </Typography>
                      <Stack spacing={0.75}>
                        {confirmed.map((l) => (
                          <LinkRow key={l.id} link={l} store={store} onIgnore={onIgnore} />
                        ))}
                      </Stack>
                    </Box>
                  )}
                  {links.length === 0 && (
                    <Typography variant="caption" color="text.secondary">
                      暂无交叉关联，点击上方按钮由 AI 生成建议。
                    </Typography>
                  )}
                </>
              )
            })()}
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}
