-- =====================================================================
-- 桌球雙打賽即時計分系統：Supabase 資料庫設定
-- 用法：Supabase 專案 → SQL Editor → New query → 貼上全部內容 → Run
-- 可以重複執行，不會清掉已有的資料。
-- =====================================================================

-- ---------- 1. 資料表 ----------

-- 大會設定（只有一列，id 固定為 1）
create table if not exists public.settings (
  id           int primary key default 1 check (id = 1),
  status       text not null default 'setup' check (status in ('setup', 'active')),
  match_format text not null default 'best_of_3' check (match_format in ('best_of_3', 'best_of_5')),
  updated_at   timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- 雙打組合
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  player_a   text not null check (char_length(btrim(player_a)) between 1 and 40),
  player_b   text not null check (char_length(btrim(player_b)) between 1 and 40),
  division   text not null check (division in ('competitive', 'fun')),
  draw_rank  int check (draw_rank between 1 and 99),  -- 戰績完全相同時的抽籤順位
  created_at timestamptz not null default now()
);

-- 對戰
create table if not exists public.matches (
  id           uuid primary key default gen_random_uuid(),
  division     text not null check (division in ('competitive', 'fun')),
  round        int not null check (round >= 1),
  seq          int not null default 0,
  team1_id     uuid not null references public.teams(id) on delete cascade,
  team2_id     uuid not null references public.teams(id) on delete cascade,
  match_format text not null check (match_format in ('best_of_3', 'best_of_5')),
  games        jsonb not null default '[]'::jsonb check (jsonb_typeof(games) = 'array'),  -- 每局比分，例如 [[11,8],[9,11]]
  winner_id    uuid references public.teams(id) on delete set null,
  status       text not null default 'not_started' check (status in ('not_started', 'playing', 'completed')),
  updated_at   timestamptz not null default now()
);
create index if not exists matches_division_round_idx on public.matches (division, round, seq);

-- 主辦帳號名單（只能在這裡的 SQL 修改，網頁讀不到這張表）
create table if not exists public.organizers (
  email text primary key
);

-- ---------- 2. 安全規則（由伺服器執行，網頁無法略過） ----------

create or replace function public.is_organizer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organizers
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table public.settings   enable row level security;
alter table public.teams      enable row level security;
alter table public.matches    enable row level security;
alter table public.organizers enable row level security;  -- 不設任何規則 = 網頁完全無法存取

do $$
declare
  t text;
begin
  foreach t in array array['settings', 'teams', 'matches'] loop
    -- 所有人都可以讀（選手看板需要）
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
    -- 只有主辦帳號可以新增、修改、刪除
    execute format('drop policy if exists "organizer write" on public.%I', t);
    execute format(
      'create policy "organizer write" on public.%I for all to authenticated
         using (public.is_organizer()) with check (public.is_organizer())', t);
  end loop;
end $$;

-- ---------- 3. 即時同步（主辦輸入比分，選手手機自動更新） ----------

do $$
declare
  t text;
begin
  foreach t in array array['settings', 'teams', 'matches'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- 4. 主辦帳號 ----------
-- 這個 email 必須與 js/config.js 的 ORGANIZER_EMAIL、以及
-- Authentication → Users 建立的帳號相同。要換帳號就改這裡再執行一次。
insert into public.organizers (email) values ('organizer@dsc-table-tennis.app')
on conflict (email) do nothing;
