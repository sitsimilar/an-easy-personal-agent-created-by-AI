/**
 * 思维树林侧栏：树列表（切换/新建/重命名/删除）+ 树林列表（新建/重命名/删除/归组/移出）。
 *
 * - trees.length >= 2 时才开放「归入树林」入口；
 * - 一棵树可属多个树林，交叉按 forestId 隔离（本侧栏只做组群管理）。
 */
import { useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ForestIcon from '@mui/icons-material/Forest'
import ParkIcon from '@mui/icons-material/Park'
import type { MindForestStore } from '@shared/types/domain'

export interface ForestSidebarProps {
  store: MindForestStore
  activeTreeId: string | null
  activeForestId: string | null
  onSelectTree: (treeId: string) => void
  onSelectForest: (forestId: string | null) => void
  onCreateTree: (name: string) => void
  onRenameTree: (treeId: string, name: string) => void
  onDeleteTree: (treeId: string) => void
  onCreateForest: (name: string, treeIds: string[]) => void
  onRenameForest: (forestId: string, name: string) => void
  onDeleteForest: (forestId: string) => void
  onAddTreeToForest: (forestId: string, treeId: string) => void
  onRemoveTreeFromForest: (forestId: string, treeId: string) => void
}

type RenameTarget = { kind: 'tree' | 'forest'; id: string } | null

/** 思维树林侧栏。 */
export default function ForestSidebar({
  store,
  activeTreeId,
  activeForestId,
  onSelectTree,
  onSelectForest,
  onCreateTree,
  onRenameTree,
  onDeleteTree,
  onCreateForest,
  onRenameForest,
  onDeleteForest,
  onAddTreeToForest,
  onRemoveTreeFromForest,
}: ForestSidebarProps) {
  const [renaming, setRenaming] = useState<RenameTarget>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [creating, setCreating] = useState<'tree' | 'forest' | null>(null)
  const [createDraft, setCreateDraft] = useState('')
  const [expandedForest, setExpandedForest] = useState<string | null>(null)

  const trees = store.trees
  const forests = store.forests
  const canGroup = trees.length >= 2

  const treeNameOf = (id: string): string => trees.find((t) => t.id === id)?.name ?? '(已删除)'

  const beginRename = (kind: 'tree' | 'forest', id: string, name: string): void => {
    setRenaming({ kind, id })
    setRenameDraft(name)
  }

  const commitRename = (): void => {
    if (!renaming) return
    const name = renameDraft.trim()
    if (name) {
      if (renaming.kind === 'tree') onRenameTree(renaming.id, name)
      else onRenameForest(renaming.id, name)
    }
    setRenaming(null)
    setRenameDraft('')
  }

  const beginCreateTree = (): void => {
    setCreating('tree')
    setCreateDraft('')
  }

  const beginCreateForest = (): void => {
    setCreating('forest')
    setCreateDraft('')
  }

  const commitCreate = (): void => {
    const name = createDraft.trim()
    if (creating === 'tree') {
      if (name) onCreateTree(name)
    } else if (creating === 'forest') {
      if (name) onCreateForest(name, activeTreeId ? [activeTreeId] : [])
    }
    setCreating(null)
    setCreateDraft('')
  }

  const cancelCreate = (): void => {
    setCreating(null)
    setCreateDraft('')
  }

  const renameField = (
    onKeyEnter: () => void,
  ): React.ReactElement => (
    <Stack direction="row" spacing={0.5} sx={{ py: 0.25 }}>
      <TextField
        size="small"
        fullWidth
        autoFocus
        value={renameDraft}
        onChange={(e) => setRenameDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onKeyEnter()
          if (e.key === 'Escape') {
            setRenaming(null)
            setRenameDraft('')
          }
        }}
      />
      <IconButton size="small" onClick={onKeyEnter}>
        <CheckIcon fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        onClick={() => {
          setRenaming(null)
          setRenameDraft('')
        }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </Stack>
  )

  const createField = (placeholder: string): React.ReactElement => (
    <Stack direction="row" spacing={0.5} sx={{ py: 0.25 }}>
      <TextField
        size="small"
        fullWidth
        autoFocus
        placeholder={placeholder}
        value={createDraft}
        onChange={(e) => setCreateDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitCreate()
          if (e.key === 'Escape') cancelCreate()
        }}
      />
      <IconButton size="small" onClick={commitCreate}>
        <CheckIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" onClick={cancelCreate}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </Stack>
  )

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <Typography
        variant="subtitle2"
        gutterBottom
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
      >
        <ForestIcon fontSize="small" />
        思维树林
      </Typography>

      {/* 树列表 */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          思维树（{trees.length}）
        </Typography>
        {creating !== 'tree' && (
          <Button size="small" startIcon={<AddIcon />} onClick={beginCreateTree}>
            新建树
          </Button>
        )}
      </Stack>
      {creating === 'tree' && <Box sx={{ mb: 0.5 }}>{createField('输入思维树主题/标题')}</Box>}
      <Stack spacing={0.5}>
        {trees.map((t) =>
          renaming?.kind === 'tree' && renaming.id === t.id ? (
            <Box key={t.id}>{renameField(commitRename)}</Box>
          ) : (
            <Stack
              key={t.id}
              direction="row"
              alignItems="center"
              spacing={0.25}
              sx={{
                bgcolor: activeTreeId === t.id ? 'action.selected' : 'transparent',
                borderRadius: 1,
                px: 0.5,
              }}
            >
              <Typography
                variant="body2"
                title={t.name}
                onClick={() => onSelectTree(t.id)}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  cursor: 'pointer',
                  fontWeight: activeTreeId === t.id ? 700 : 400,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.name}
              </Typography>
              <Tooltip title="重命名">
                <IconButton size="small" onClick={() => beginRename('tree', t.id, t.name)}>
                  <EditIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除整棵树">
                <IconButton
                  size="small"
                  onClick={() => {
                    if (window.confirm(`删除树「${t.name}」及其全部交叉关系？`)) onDeleteTree(t.id)
                  }}
                >
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Stack>
          ),
        )}
        {trees.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            暂无思维树
          </Typography>
        )}
      </Stack>

      <Divider sx={{ my: 1.5 }} />

      {/* 树林列表（≥2 树才开放归组） */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          思维树林（{forests.length}）
        </Typography>
        {canGroup && creating !== 'forest' && (
          <Button size="small" startIcon={<AddIcon />} onClick={beginCreateForest}>
            新建树林
          </Button>
        )}
      </Stack>
      {canGroup && creating === 'forest' && <Box sx={{ mb: 0.5 }}>{createField('输入树林名称')}</Box>}
      {!canGroup ? (
        <Typography variant="caption" color="text.secondary">
          至少 2 棵树才能归入树林
        </Typography>
      ) : (
        <Stack spacing={0.5}>
          {forests.map((f) => {
            const expanded = expandedForest === f.id
            return (
              <Box key={f.id}>
                {renaming?.kind === 'forest' && renaming.id === f.id ? (
                  renameField(commitRename)
                ) : (
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={0.25}
                    sx={{
                      bgcolor: activeForestId === f.id ? 'action.selected' : 'transparent',
                      borderRadius: 1,
                      px: 0.5,
                    }}
                  >
                    <Typography
                      variant="body2"
                      title={`${f.name}（${f.treeIds.length} 棵树）`}
                      onClick={() => {
                        onSelectForest(activeForestId === f.id ? null : f.id)
                        if (activeForestId !== f.id) setExpandedForest(f.id)
                      }}
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        cursor: 'pointer',
                        fontWeight: activeForestId === f.id ? 700 : 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {f.name}（{f.treeIds.length}）
                    </Typography>
                    <Tooltip title={expanded ? '收起' : '展开'}>
                      <IconButton
                        size="small"
                        onClick={() => setExpandedForest(expanded ? null : f.id)}
                      >
                        {expanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="重命名">
                      <IconButton size="small" onClick={() => beginRename('forest', f.id, f.name)}>
                        <EditIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="删除树林（不删除树）">
                      <IconButton
                        size="small"
                        onClick={() => {
                          if (window.confirm(`删除树林「${f.name}」及其交叉关系？（树不会被删除）`)) onDeleteForest(f.id)
                        }}
                      >
                        <DeleteIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                )}
                {expanded && (
                  <Stack spacing={0.5} sx={{ pl: 1, mt: 0.5 }}>
                    {f.treeIds.map((tid) => (
                      <Stack key={tid} direction="row" alignItems="center" spacing={0.5}>
                        <ParkIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography
                          variant="caption"
                          sx={{
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {treeNameOf(tid)}
                        </Typography>
                        <IconButton
                          size="small"
                          title="移出树林"
                          onClick={() => onRemoveTreeFromForest(f.id, tid)}
                        >
                          <CloseIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Stack>
                    ))}
                    {activeTreeId && !f.treeIds.includes(activeTreeId) && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => onAddTreeToForest(f.id, activeTreeId)}
                      >
                        归入当前树
                      </Button>
                    )}
                    {activeTreeId && f.treeIds.includes(activeTreeId) && (
                      <Chip size="small" label="当前树已在此树林" sx={{ fontSize: 11, height: 22 }} />
                    )}
                  </Stack>
                )}
              </Box>
            )
          })}
          {forests.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              暂无树林
            </Typography>
          )}
        </Stack>
      )}
    </Box>
  )
}
