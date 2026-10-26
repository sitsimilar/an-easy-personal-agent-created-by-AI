-- =============================================================================
-- 个人信息管家 · P0 增量迁移（2026-10 / 基线 v2.11.0）
-- 范围：P0-A 系统级提醒、P0-B 待办循环、P0-C 链接元数据
-- 特性：纯增量（只加列/加索引/加约束），全部可空或有默认值，幂等可重复执行；
--       不改既有 4 条 RLS 策略（策略按 owner_id，不列字段），不搬迁数据。
-- 执行方式：在云库 SQL 控制台整段执行一次（或按段执行），失败可原样重跑。
-- 回滚：应用侧不依赖这些列时可直接回退代码；如需撤销见文件末尾（默认注释）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. records 增量列
--    recurrence          JSONB  循环规则 {freq,interval,weekdays?,endDate?}（键为 camelCase）
--    recurrence_parent_id BIGINT 根记录为 NULL，子记录回指根记录
--    recurrence_next_id  BIGINT  本条生成的下一期 id（幂等 + 追溯"由第 N 期生成"）
--    link_meta           JSONB  {title,description,image,site,fetchedAt,status,errorCode?}
-- ---------------------------------------------------------------------------
ALTER TABLE public.records
  ADD COLUMN IF NOT EXISTS recurrence           JSONB,
  ADD COLUMN IF NOT EXISTS recurrence_parent_id BIGINT,
  ADD COLUMN IF NOT EXISTS recurrence_next_id   BIGINT,
  ADD COLUMN IF NOT EXISTS link_meta            JSONB;

COMMENT ON COLUMN public.records.recurrence IS 'P0-B 循环规则 {freq:daily|weekly|monthly,interval:1..99,weekdays:number[],endDate:YYYY-MM-DD|null}';
COMMENT ON COLUMN public.records.recurrence_parent_id IS 'P0-B 循环链根记录 id（根记录为 NULL）';
COMMENT ON COLUMN public.records.recurrence_next_id IS 'P0-B 由本条生成的下一期记录 id';
COMMENT ON COLUMN public.records.link_meta IS 'P0-C 链接元数据 {title,description,image,site,fetchedAt,status:ok|failed,errorCode?}';

-- ---------------------------------------------------------------------------
-- 2. settings 增量列（总开关复用既有 notify_enabled）
-- ---------------------------------------------------------------------------
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS remind_lead_minutes  INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_start          TEXT    NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS quiet_end            TEXT    NOT NULL DEFAULT '08:00';

COMMENT ON COLUMN public.settings.remind_lead_minutes IS 'P0-A 提醒提前量（分钟）：0/5/10/15/30/60';
COMMENT ON COLUMN public.settings.quiet_hours_enabled IS 'P0-A 免打扰开关';
COMMENT ON COLUMN public.settings.quiet_start IS 'P0-A 免打扰起始（本地墙钟 HH:mm）';
COMMENT ON COLUMN public.settings.quiet_end IS 'P0-A 免打扰结束（本地墙钟 HH:mm），可跨零点';

-- ---------------------------------------------------------------------------
-- 3. 约束（幂等：PG 不支持 ADD CONSTRAINT IF NOT EXISTS，用 catalog 判重）
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'records_recurrence_next_id_chk' AND conrelid = 'public.records'::regclass
  ) THEN
    ALTER TABLE public.records
      ADD CONSTRAINT records_recurrence_next_id_chk CHECK (recurrence_next_id IS NULL OR recurrence_next_id > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settings_remind_lead_minutes_chk' AND conrelid = 'public.settings'::regclass
  ) THEN
    ALTER TABLE public.settings
      ADD CONSTRAINT settings_remind_lead_minutes_chk CHECK (remind_lead_minutes BETWEEN 0 AND 1440);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settings_quiet_time_chk' AND conrelid = 'public.settings'::regclass
  ) THEN
    ALTER TABLE public.settings
      ADD CONSTRAINT settings_quiet_time_chk CHECK (
        quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
        quiet_end   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. 索引
--    提醒轮询：owner_id + todo_status + remind_at（只扫未删除，减少无效行）
--    循环追溯：owner_id + recurrence_next_id（可选，量小可留）
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS records_owner_todo_remind_idx
  ON public.records (owner_id, todo_status, remind_at)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS records_owner_recurrence_next_idx
  ON public.records (owner_id, recurrence_next_id)
  WHERE recurrence_next_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS records_owner_recurrence_parent_idx
  ON public.records (owner_id, recurrence_parent_id)
  WHERE recurrence_parent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. 自检（执行后人工核对，应为 7 / 4）
-- ---------------------------------------------------------------------------
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='records'
--    AND column_name IN ('recurrence','recurrence_parent_id','recurrence_next_id','link_meta');   -- 期望 4
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='settings'
--    AND column_name IN ('remind_lead_minutes','quiet_hours_enabled','quiet_start','quiet_end');   -- 期望 4
-- SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('records','settings'); -- 期望各 4 条

-- ---------------------------------------------------------------------------
-- 6. 回滚（默认注释，仅在确需清理数据时手工执行；一般只需回退应用代码）
-- ---------------------------------------------------------------------------
-- DROP INDEX IF EXISTS public.records_owner_todo_remind_idx;
-- DROP INDEX IF EXISTS public.records_owner_recurrence_next_idx;
-- DROP INDEX IF EXISTS public.records_owner_recurrence_parent_idx;
-- ALTER TABLE public.records
--   DROP CONSTRAINT IF EXISTS records_recurrence_next_id_chk,
--   DROP COLUMN IF EXISTS recurrence,
--   DROP COLUMN IF EXISTS recurrence_parent_id,
--   DROP COLUMN IF EXISTS recurrence_next_id,
--   DROP COLUMN IF EXISTS link_meta;
-- ALTER TABLE public.settings
--   DROP CONSTRAINT IF EXISTS settings_remind_lead_minutes_chk,
--   DROP CONSTRAINT IF EXISTS settings_quiet_time_chk,
--   DROP COLUMN IF EXISTS remind_lead_minutes,
--   DROP COLUMN IF EXISTS quiet_hours_enabled,
--   DROP COLUMN IF EXISTS quiet_start,
--   DROP COLUMN IF EXISTS quiet_end;
