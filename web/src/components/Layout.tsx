import { useEffect, useState, type MouseEvent } from 'react'
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Collapse,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import HomeIcon from '@mui/icons-material/Home'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import FolderIcon from '@mui/icons-material/Folder'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import InsightsIcon from '@mui/icons-material/Insights'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import HandymanIcon from '@mui/icons-material/Handyman'
import DeleteIcon from '@mui/icons-material/Delete'
import SettingsIcon from '@mui/icons-material/Settings'
import LogoutIcon from '@mui/icons-material/Logout'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import DownloadIcon from '@mui/icons-material/Download'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore, useCurrentUser } from '@/store/authStore'
import { useRecordStore } from '@/store/recordStore'
import { useProfileStore } from '@/store/profileStore'
import { authService } from '@/services/authService'
import { recordService } from '@/services/recordService'
import { PRESET_CATEGORIES } from '@shared/constants/categories'
import SearchBar from './SearchBar'
import ContextMenu from './ContextMenu'
import RecordCreateDialog from './RecordCreateDialog'
import TitleBar, { TITLE_BAR_HEIGHT } from './TitleBar'

const DRAWER_WIDTH = 240

interface LayoutProps {
  /** 是否桌面主窗口模式（由 App 传入 ?desktop=1 检测结果） */
  desktopMain?: boolean
}

type CountKey = 'all' | 'idea' | 'material' | 'todoPending'

interface NavItem {
  label: string
  path: string
  icon: React.ReactNode
  countKey?: CountKey
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: '工作台',
    items: [
      { label: '全部信息', path: '/', icon: <HomeIcon fontSize="small" />, countKey: 'all' },
      { label: '想法', path: '/records?type=idea', icon: <LightbulbIcon fontSize="small" />, countKey: 'idea' },
      { label: '资料', path: '/records?type=material', icon: <FolderIcon fontSize="small" />, countKey: 'material' },
      { label: '待办', path: '/todo', icon: <CheckCircleIcon fontSize="small" />, countKey: 'todoPending' },
      { label: '日历', path: '/calendar', icon: <CalendarMonthIcon fontSize="small" /> },
      { label: '回顾', path: '/review', icon: <InsightsIcon fontSize="small" /> },
    ],
  },
  {
    title: '智能能力',
    items: [
      { label: '思维树', path: '/mindtree', icon: <AccountTreeIcon fontSize="small" /> },
      { label: '工具箱', path: '/tools', icon: <HandymanIcon fontSize="small" /> },
    ],
  },
  {
    title: '系统',
    items: [
      { label: '回收站', path: '/recycle', icon: <DeleteIcon fontSize="small" /> },
      { label: '设置', path: '/settings', icon: <SettingsIcon fontSize="small" /> },
    ],
  },
]

/** 搜索范围下拉（命令栏左侧）。 */
const SCOPE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'idea', label: '想法' },
  { value: 'material', label: '资料' },
  { value: 'todo', label: '待办' },
]

type CountsValue = { all: number; idea: number; material: number; todoPending: number }
/** 导航徽标计数缓存（60s 内复用，避免每次切页 4 条 count 查询）。 */
let countsCache: { value: CountsValue; ts: number } | null = null
const COUNTS_TTL_MS = 60_000

export default function Layout({ desktopMain }: LayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useCurrentUser()
  const clear = useAuthStore((s) => s.clear)
  const profileNickname = useProfileStore((s) => s.nickname)
  const profileAvatar = useProfileStore((s) => s.avatarUrl)
  const [createOpen, setCreateOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [counts, setCounts] = useState<{ all?: number; idea?: number; material?: number; todoPending?: number } | null>(null)

  // 桌面主窗口模式：query 参数 ?desktop=1 或存在 desktopBridge 均视为桌面环境
  const isDesktop = Boolean(desktopMain) || Boolean(window.desktopBridge)
  const topOffset = 64 + (isDesktop ? TITLE_BAR_HEIGHT : 0)

  // 导航徽标计数（60s 缓存；拉不到就省略，不写死）
  useEffect(() => {
    if (countsCache && Date.now() - countsCache.ts < COUNTS_TTL_MS) {
      setCounts(countsCache.value)
      return
    }
    let cancelled = false
    recordService
      .counts()
      .then((c) => {
        countsCache = { value: c, ts: Date.now() }
        if (!cancelled) setCounts(c)
      })
      .catch(() => {
        if (!cancelled) setCounts(null)
      })
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  const scope = (() => {
    if (location.pathname === '/todo') return 'todo'
    if (location.pathname.startsWith('/records')) {
      const type = new URLSearchParams(location.search).get('type')
      if (type === 'idea') return 'idea'
      if (type === 'material') return 'material'
    }
    return 'all'
  })()

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname + location.search === path
  }

  const handleSearch = (keyword: string) => {
    navigate(`/records?keyword=${encodeURIComponent(keyword)}`)
  }

  const handleScopeChange = (value: string) => {
    if (value === 'all') navigate('/')
    else if (value === 'idea') navigate('/records?type=idea')
    else if (value === 'material') navigate('/records?type=material')
    else if (value === 'todo') navigate('/todo')
  }

  const handleExport = () => {
    // 用 getState 读取当前列表，避免 Layout 订阅 records 导致整壳随列表变化重渲染
    const records = useRecordStore.getState().records
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `personal-agent-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleContextMenu = (e: MouseEvent<HTMLElement>) => {
    // 桌面环境（主窗口/悬浮窗）由 Electron 原生菜单接管，避免双菜单
    if (window.desktopBridge) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleLogout = async () => {
    try {
      await authService.signOut()
    } catch {
      /* 忽略登出错误 */
    }
    clear()
    navigate('/login', { replace: true })
  }

  const userLabel = user?.name || user?.phone || user?.email || '用户'
  const displayName = profileNickname?.trim() || userLabel

  const countOf = (key?: CountKey) => (key && counts ? counts[key] : undefined)

  return (
    <Box sx={{ display: 'flex', height: '100vh' }} onContextMenu={handleContextMenu}>
      {isDesktop && <TitleBar />}
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          top: isDesktop ? TITLE_BAR_HEIGHT : 0,
          zIndex: (theme) => theme.zIndex.drawer + 1,
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ gap: 1.5 }}>
          <Typography variant="h6" fontWeight={700} noWrap sx={{ mr: 0.5 }}>
            个人信息管家
          </Typography>
          <Select
            size="small"
            value={scope}
            onChange={(e) => handleScopeChange(e.target.value)}
            sx={{ minWidth: 92, fontSize: 13, flex: 'none' }}
          >
            {SCOPE_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
          <Box sx={{ flex: 1, maxWidth: 560 }}>
            <SearchBar onSearch={handleSearch} />
          </Box>
          <Tooltip title="快速记录">
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateOpen(true)}
              sx={{ flex: 'none' }}
            >
              快速记录
            </Button>
          </Tooltip>
          <Tooltip title="导出当前列表为 JSON">
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExport} sx={{ flex: 'none' }}>
              导出
            </Button>
          </Tooltip>
          <Tooltip title={displayName}>
            <Avatar
              src={profileAvatar ?? undefined}
              sx={{ bgcolor: 'primary.main', width: 34, height: 34, fontSize: 14 }}
            >
              {displayName.slice(0, 1)}
            </Avatar>
          </Tooltip>
          <Tooltip title="退出登录">
            <IconButton onClick={handleLogout}>
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box', pt: `${topOffset}px` },
        }}
      >
        <List component="nav" sx={{ px: 1, flex: 1, overflow: 'auto' }}>
          {NAV_GROUPS.map((group) => (
            <Box key={group.title} sx={{ mb: 1 }}>
              <Typography
                variant="overline"
                sx={{ px: 1.5, pt: 1, pb: 0.5, display: 'block', color: 'text.disabled', fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}
              >
                {group.title}
              </Typography>
              {group.items.map((item) => {
                const count = countOf(item.countKey)
                const active = isActive(item.path)
                return (
                  <ListItemButton
                    key={item.label}
                    selected={active}
                    onClick={() => navigate(item.path)}
                    aria-current={active ? 'page' : undefined}
                    sx={{ borderRadius: 2, mb: 0.25 }}
                  >
                    <ListItemIcon sx={{ minWidth: 34 }}>{item.icon}</ListItemIcon>
                    <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14 }} />
                    {count !== undefined && (
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'text.secondary',
                          fontSize: 12,
                          minWidth: 20,
                          textAlign: 'center',
                          bgcolor: 'action.hover',
                          borderRadius: 1.5,
                          px: 0.75,
                          py: 0.25,
                        }}
                      >
                        {count}
                      </Typography>
                    )}
                  </ListItemButton>
                )
              })}
            </Box>
          ))}

          <Divider sx={{ my: 1 }} />
          <ListItemButton onClick={() => setCategoryOpen((v) => !v)} sx={{ borderRadius: 2 }}>
            <ListItemIcon sx={{ minWidth: 34 }}>
              <FolderIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="分类标签" primaryTypographyProps={{ fontSize: 14 }} />
            {categoryOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </ListItemButton>
          <Collapse in={categoryOpen} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {PRESET_CATEGORIES.map((c) => (
                <ListItemButton
                  key={c.key}
                  sx={{ pl: 5, borderRadius: 2 }}
                  onClick={() => navigate(`/records?category=${encodeURIComponent(c.key)}`)}
                >
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: c.color,
                      mr: 1.5,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText primary={c.label} primaryTypographyProps={{ fontSize: 13 }} />
                </ListItemButton>
              ))}
            </List>
          </Collapse>
        </List>
      </Drawer>

      <Box component="main" sx={{ flex: 1, pt: `${topOffset}px`, overflow: 'auto', height: '100vh' }}>
        {/* 页面切换转场：以 pathname 为 key 触发淡入+上移（180ms），尊重 prefers-reduced-motion */}
        <Box key={location.pathname} className="page-in" sx={{ minHeight: '100%' }}>
          <Outlet />
        </Box>
      </Box>

      <RecordCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => setCreateOpen(false)}
      />

      <ContextMenu
        open={!!contextMenu}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        onClose={() => setContextMenu(null)}
      />
    </Box>
  )
}
