import { createTheme } from '@mui/material/styles'

/** 等宽字体 token（代码编辑器/输出面板共用）。 */
export const MONO_FONT = '"JetBrains Mono",SFMono-Regular,Consolas,"Liberation Mono",monospace'

/** 全局动效 token：统一时长与缓动（转场/面板切换/节点展开共用）。 */
export const MOTION = {
  /** 转场时长（ms）。 */
  duration: 180,
  /** 启动界面→内容交叉淡出时长（ms）。 */
  bootDuration: 240,
  /** 统一缓动曲线。 */
  easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const

/**
 * MUI 主题 —— 对齐交互原型「Color Tokens」。
 * 品牌主色 #5B54D9；文字/面/线/语义色与圆角均从原型 :root 提取。
 */
const theme = createTheme({
  palette: {
    primary: {
      main: '#5B54D9',
      dark: '#4A43C4',
      light: '#6B64E3',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#4A43C4',
      contrastText: '#ffffff',
    },
    error: { main: '#C4342F' },
    warning: { main: '#D97706' },
    success: { main: '#15803D' },
    info: { main: '#5B54D9' },
    background: {
      default: '#F7F7F9',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#18181B',
      secondary: '#64646E',
      disabled: '#9A9AA6',
    },
    divider: '#E7E7EC',
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily:
      '"Noto Sans SC","PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          borderColor: '#E7E7EC',
        },
      },
    },
  },
})

export default theme
