-- =====================================================================
-- 升級 01：每局改為記錄實際得分（例如 11:8），不只記錄勝方
-- 用法：Supabase → SQL Editor → New query → 貼上全部內容 → Run
-- 只有 2026-10 以前用舊版 setup.sql 建立的專案需要執行；可以重複執行。
-- =====================================================================

do $$
begin
  -- 已經是新格式就不用處理
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'matches' and column_name = 'games') = 'jsonb' then
    raise notice '已經是新格式，不需要升級';
    return;
  end if;

  -- 舊格式只有勝方、沒有分數，無法換算；有比分資料時停止，避免資料被清掉
  if exists (select 1 from public.matches where cardinality(games) > 0) then
    raise exception '資料庫裡已有舊格式的比分，請先在網站「重設賽程」後再執行這個升級';
  end if;

  alter table public.matches alter column games drop default;
  alter table public.matches alter column games type jsonb using '[]'::jsonb;
  alter table public.matches alter column games set default '[]'::jsonb;
  alter table public.matches add constraint matches_games_is_array check (jsonb_typeof(games) = 'array');
  raise notice '升級完成';
end $$;
