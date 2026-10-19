/**
 * 悬浮窗本地引导页逻辑：远程加载失败时展示，提供重试入口。
 */
interface LocalBridge {
  reloadRemote: () => void
}

const retryButton = document.getElementById('retry')
const message = document.getElementById('msg')

if (message) {
  message.textContent = '无法加载主界面，请检查网络后重试。'
}

retryButton?.addEventListener('click', () => {
  const bridge = (window as unknown as { desktopBridge?: LocalBridge }).desktopBridge
  if (bridge) {
    bridge.reloadRemote()
  } else {
    window.location.reload()
  }
})
