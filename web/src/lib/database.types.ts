/**
 * Database 泛型类型（供 createWorkBuddyCloud<Database> 强类型）。
 *
 * 列名与数据库 snake_case 完全一致。Row 用于 .select('*') 返回类型；
 * Insert / Update 采用宽松映射，避免与 PostgREST 默认值语义冲突。
 */

export interface RecordsRow {
  id: number
  owner_id: string
  type: 'idea' | 'material' | 'todo'
  title: string
  content: string
  url: string | null
  file_path: string | null
  category: string | null
  tags: string[]
  summary: string | null
  todo_status: 'pending' | 'done' | null
  priority: 'high' | 'medium' | 'low' | null
  remind_at: string | null
  /** P0-B 循环规则（JSONB，脏数据按 null 处理）。 */
  recurrence: unknown
  /** P0-B 循环链根记录 id。 */
  recurrence_parent_id: number | null
  /** P0-B 由本条生成的下一期记录 id。 */
  recurrence_next_id: number | null
  /** P0-C 链接元数据（JSONB）。 */
  link_meta: unknown
  is_deleted: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface RecordLinksRow {
  id: number
  owner_id: string
  source_id: number
  target_id: number
  score: number
  reason: string | null
  created_at: string
}

export interface CodeAnalysesRow {
  id: number
  owner_id: string
  solution_name: string
  solution_path: string | null
  project_name: string | null
  issues: unknown
  summary: string | null
  status: 'pending' | 'analyzing' | 'done' | 'failed'
  created_at: string
}

export interface SettingsRow {
  id: number
  owner_id: string
  vs_path: string | null
  code_upload_enabled: boolean
  float_window_enabled: boolean
  float_position: unknown
  notify_enabled: boolean
  /** P0-A 提醒提前量（分钟）。 */
  remind_lead_minutes: number
  /** P0-A 免打扰开关。 */
  quiet_hours_enabled: boolean
  /** P0-A 免打扰起始（本地墙钟 HH:mm）。 */
  quiet_start: string
  /** P0-A 免打扰结束（本地墙钟 HH:mm）。 */
  quiet_end: string
  avatar_image_id: number | null
  nickname: string | null
  updated_at: string
}

export interface ImagesRow {
  id: number
  owner_id: string
  name: string
  mime_type: string
  size: number
  original_path: string | null
  thumb_128_path: string | null
  thumb_256_path: string | null
  thumb_512_path: string | null
  created_at: string
  updated_at: string
}

export interface PluginsRow {
  id: number
  owner_id: string
  plugin_id: string
  name: string
  version: string
  description: string
  author: string | null
  repo_url: string | null
  permissions: string[]
  entry_path: string
  enabled: boolean
  installed_at: string
  updated_at: string
}

export interface MindTreesRow {
  id: number
  owner_id: string
  /** 整份思维树林文档（MindForestStore 序列化），JSONB。 */
  payload: unknown
  updated_at: string
}

interface TableDef<Row> {
  Row: Row
  Insert: Record<string, unknown>
  Update: Record<string, unknown>
  Relationships: []
}

export interface Database {
  Tables: {
    records: TableDef<RecordsRow>
    record_links: TableDef<RecordLinksRow>
    code_analyses: TableDef<CodeAnalysesRow>
    settings: TableDef<SettingsRow>
    images: TableDef<ImagesRow>
    plugins: TableDef<PluginsRow>
    mind_trees: TableDef<MindTreesRow>
  }
  Views: Record<string, never>
  Functions: Record<string, never>
}
