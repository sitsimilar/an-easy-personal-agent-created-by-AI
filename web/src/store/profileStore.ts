import { create } from 'zustand'

interface ProfileState {
  /** 用户昵称（空/无则回退登录名首字）。 */
  nickname: string | null
  /** 头像签名 URL（t128 缩略图，可能过期，下次进入设置页刷新）。 */
  avatarUrl: string | null
  setProfile: (patch: { nickname?: string | null; avatarUrl?: string | null }) => void
}

/** 全局账户资料缓存：SettingsPage 保存后写入，顶栏/其它全局位置即时生效。 */
export const useProfileStore = create<ProfileState>((set) => ({
  nickname: null,
  avatarUrl: null,
  setProfile: (patch) => set(patch),
}))
