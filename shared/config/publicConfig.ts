/**
 * 云服务公开配置（唯一注入点，值来自构建时环境变量）。
 *
 * 全项目禁止在任何其他文件散落 endpoint / publishableKey / oauthRelayBaseUrl。
 * 开源 / 多环境使用：复制 `web/.env.example` 为 `web/.env`，填入你自己的
 * 云服务信息（endpoint / publishableKey）。这些是「可发布」的客户端配置，
 * 并非服务端密钥；数据安全由云端 RLS（行级安全，按 owner_id 隔离）保证。
 */
export const publicConfig = {
  /** 云服务 endpoint（你的云应用发布域名）。 */
  endpoint: import.meta.env.VITE_CLOUD_ENDPOINT ?? '',
  /** OAuth 中转（微信扫码登录用），WorkBuddy 公共平台地址，一般无需改动。 */
  oauthRelayBaseUrl:
    import.meta.env.VITE_OAUTH_RELAY_BASE_URL ?? 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  /** 云服务 publishable key（客户端公开 key，非服务端密钥）。 */
  publishableKey: import.meta.env.VITE_CLOUD_PUBLISHABLE_KEY ?? '',
}
