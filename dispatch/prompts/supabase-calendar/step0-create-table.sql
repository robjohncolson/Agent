-- Supabase Calendar Integration: topic_schedule table
-- Run this in the Supabase SQL Editor (https://hgvnytaqmuybzbotosyj.supabase.co)

-- 1. Create table
CREATE TABLE IF NOT EXISTS topic_schedule (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  topic         text        NOT NULL,
  period        text        NOT NULL CHECK (period IN ('B', 'E')),
  date          date        NOT NULL,
  title         text,
  status        text        NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'posted', 'taught')),
  schoology_folder_id text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 2. Unique constraint: one row per topic per period (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'topic_schedule_topic_period_unique'
  ) THEN
    ALTER TABLE topic_schedule
      ADD CONSTRAINT topic_schedule_topic_period_unique UNIQUE (topic, period);
  END IF;
END $$;

-- 3. Indexes
CREATE INDEX IF NOT EXISTS topic_schedule_period_date_idx
  ON topic_schedule (period, date);

CREATE INDEX IF NOT EXISTS topic_schedule_topic_period_idx
  ON topic_schedule (topic, period);

-- 4. Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_topic_schedule_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS topic_schedule_updated_at ON topic_schedule;
CREATE TRIGGER topic_schedule_updated_at
  BEFORE UPDATE ON topic_schedule
  FOR EACH ROW
  EXECUTE FUNCTION update_topic_schedule_updated_at();

-- 5. RLS: anon read, service-role write (matches agent_events / agent_checkpoints pattern)
ALTER TABLE topic_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_topic_schedule" ON topic_schedule;
CREATE POLICY "anon_read_topic_schedule"
  ON topic_schedule FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "service_role_all_topic_schedule" ON topic_schedule;
CREATE POLICY "service_role_all_topic_schedule"
  ON topic_schedule FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
