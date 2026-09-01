CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS guilds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  server text NOT NULL DEFAULT 'Europe',
  tax_rate numeric(5,4) NOT NULL DEFAULT 0.15 CHECK (tax_rate BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  username text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','officer','member')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guild_id, username)
);

CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  pseudo text NOT NULL,
  discord text,
  primary_role text,
  guild_rank text NOT NULL DEFAULT 'Membre',
  status text NOT NULL DEFAULT 'Actif',
  joined_at date,
  build text,
  average_ip integer,
  weekly_fame bigint NOT NULL DEFAULT 0,
  weekly_contribution bigint NOT NULL DEFAULT 0,
  last_activity_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guild_id, pseudo)
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  code text NOT NULL,
  starts_at timestamptz NOT NULL,
  type text NOT NULL,
  leader text,
  zone text,
  tier text,
  min_ip integer,
  status text NOT NULL DEFAULT 'Prévu',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guild_id, code)
);

CREATE TABLE IF NOT EXISTS attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  attendance_status text NOT NULL DEFAULT 'Présent',
  payout_weight numeric(6,2) NOT NULL DEFAULT 1,
  role text,
  notes text,
  UNIQUE(event_id, member_id)
);

CREATE TABLE IF NOT EXISTS loot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  category text NOT NULL DEFAULT 'Stuff',
  tier text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price bigint NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  sold boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  gross_amount bigint NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  tax_rate numeric(5,4) NOT NULL DEFAULT 0.15 CHECK (tax_rate BETWEEN 0 AND 1),
  net_amount bigint GENERATED ALWAYS AS (ROUND(gross_amount * (1-tax_rate))) STORED,
  status text NOT NULL DEFAULT 'A payer',
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, member_id)
);

CREATE TABLE IF NOT EXISTS treasury_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  entry_type text NOT NULL CHECK (entry_type IN ('Entree','Sortie')),
  category text NOT NULL,
  description text NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0),
  responsible text,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recruitment_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  pseudo text NOT NULL,
  discord text,
  target_role text,
  experience text,
  applied_at date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'Nouveau',
  trial_end date,
  recruiter text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_members_guild_status ON members(guild_id,status);
CREATE INDEX IF NOT EXISTS idx_events_guild_starts ON events(guild_id,starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_loot_event ON loot_items(event_id);
CREATE INDEX IF NOT EXISTS idx_payouts_guild_status ON payouts(guild_id,status);
CREATE INDEX IF NOT EXISTS idx_treasury_guild_time ON treasury_entries(guild_id,occurred_at DESC);
