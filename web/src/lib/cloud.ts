import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'
import { publicConfig } from '@shared/config/publicConfig'
import type { Database } from './database.types'

/**
 * 云 SDK 单例 —— 全项目唯一创建点。
 * 其余模块一律 `import { cloud } from '@/lib/cloud'`，严禁二次 createWorkBuddyCloud。
 */
export const cloud = createWorkBuddyCloud<Database>({
  endpoint: publicConfig.endpoint,
  oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
  publishableKey: publicConfig.publishableKey,
})
