CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','pairing','connecting','connected','logged_out','error')),
  connected_at TIMESTAMPTZ,
  last_disconnect TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL DEFAULT '.',
  bot_name TEXT NOT NULL DEFAULT 'SAITAMA BOT',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_configurations (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_public BOOLEAN NOT NULL DEFAULT true,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS command_usage (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  category TEXT NOT NULL,
  succeeded BOOLEAN NOT NULL DEFAULT true,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS command_usage_user_date ON command_usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS command_usage_date ON command_usage(created_at DESC);

CREATE TABLE IF NOT EXISTS sudo_users (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, phone)
);

CREATE TABLE IF NOT EXISTS group_configurations (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_jid)
);

CREATE TABLE IF NOT EXISTS anti_spam_settings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  max_messages INTEGER NOT NULL DEFAULT 5,
  window_seconds INTEGER NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_jid)
);

CREATE TABLE IF NOT EXISTS warning_records (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_jid TEXT NOT NULL,
  member_jid TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warning_records_lookup ON warning_records(user_id, group_jid, member_jid);

CREATE TABLE IF NOT EXISTS auto_replies (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  response TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, trigger)
);

CREATE TABLE IF NOT EXISTS bot_statistics (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  messages_received BIGINT NOT NULL DEFAULT 0,
  commands_executed BIGINT NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
