import { Box, Chip, Tooltip, Typography } from '@mui/material'
import type { ToolchainItem, ToolchainStatus } from '@shared/types/ipc'

const SOURCE_LABEL: Record<NonNullable<ToolchainItem['source']>, string> = {
  path: 'PATH',
  vswhere: 'VS',
  sdk: 'SDK',
  registered: '已部署',
}

/** 配对 → 展示文案。 */
function pairLabel(status: ToolchainStatus): string {
  const sel = status.selection
  if (sel.compiler === 'cl' && sel.debugger === 'cdb') return 'MSVC cl + cdb'
  if (sel.compiler === 'gpp' && sel.debugger === 'gdb') return 'MinGW g++ + gdb'
  if (sel.compiler === 'cl') return 'MSVC cl（无调试器）'
  if (sel.compiler === 'gpp') return 'MinGW g++（无调试器）'
  return '未检测到工具链'
}

/** 工具链状态条：选中配对 + 各工具 Chip + 来源标签。 */
export default function ToolchainStatusBar({ toolchain }: { toolchain: ToolchainStatus | null }) {
  if (!toolchain) return null
  const items: { key: string; item: ToolchainItem; name: string }[] = [
    { key: 'gpp', item: toolchain.gpp, name: 'g++' },
    { key: 'gdb', item: toolchain.gdb, name: 'gdb' },
    { key: 'cl', item: toolchain.cl, name: 'cl' },
    { key: 'cdb', item: toolchain.cdb, name: 'cdb' },
  ]

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
      <Chip
        size="small"
        label={pairLabel(toolchain)}
        color={toolchain.selection.ready ? 'primary' : 'error'}
        variant="outlined"
        sx={{ fontSize: 11, height: 22 }}
      />
      {items.map(({ key, item, name }) => {
        const ver = item.version?.split(' ')[0] ?? ''
        const tooltip = item.ok
          ? item.source
            ? `来源：${SOURCE_LABEL[item.source]}`
            : ''
          : item.error ?? `${name} 缺失`
        return (
          <Tooltip key={key} title={tooltip}>
            <Chip
              size="small"
              label={item.ok ? `${name} ${ver}`.trim() : `${name} 缺失`}
              color={item.ok ? 'default' : 'error'}
              variant="outlined"
              sx={{ fontSize: 11, height: 22 }}
            />
          </Tooltip>
        )
      })}
      {toolchain.selection.reason && (
        <Typography variant="caption" color="text.secondary">
          {toolchain.selection.reason}
        </Typography>
      )}
    </Box>
  )
}
