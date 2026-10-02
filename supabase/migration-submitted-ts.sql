-- Migration 003: thêm submitted_at_ts timestamptz để lọc/phân trang server-side.
-- Chạy trong Supabase SQL Editor. Cột text submitted_at giữ nguyên, không sửa.
-- Parse wall-clock hiểu là Asia/Ho_Chi_Minh; thiếu giờ => 00:00; sai format /
-- ngoài range / ngày không tồn tại => NULL (KHÔNG normalize như to_timestamp).
--
-- Test bắt buộc sau khi chạy:
--   2/31/2026  => NULL (tháng 2/2026 có 28 ngày)
--   13/1/2026  => NULL (tháng 13)
--   3/9/2026 25:00 => NULL (giờ 25)
--   3/9/2026 13:58  => 2026-03-09T13:58+07
--   3/9/2026        => 2026-03-09T00:00+07
--   2/29/2024 => hợp lệ (nhuận), 2/29/2026 => NULL

alter table public.wholesale_leads
  add column if not exists submitted_at_ts timestamptz null;

-- Backfill: chỉ chạy cho dòng chưa có submitted_at_ts để rerun an toàn.
-- Thứ tự CASE quan trọng: check năm/tháng/giờ trước khi gọi make_date
-- (Postgres CASE short-circuit nên make_date không bao giờ nhận tháng 13).
with parsed as (
  select
    id,
    regexp_match(
      trim(submitted_at),
      '^\s*(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\s*$'
    ) as m
  from public.wholesale_leads
  where submitted_at_ts is null
)
update public.wholesale_leads as w
set submitted_at_ts = case
  when p.m is null then null
  when p.m[3]::int not between 1 and 9999 then null
  when p.m[1]::int not between 1 and 12 then null
  when p.m[4] is not null
    and (p.m[4]::int not between 0 and 23 or p.m[5]::int not between 0 and 59)
    then null
  when p.m[2]::int < 1
    or p.m[2]::int > extract(
      day from (
        date_trunc('month', make_date(p.m[3]::int, p.m[1]::int, 1))
        + interval '1 month - 1 day'
      )
    )
    then null
  else (
    make_timestamp(
      p.m[3]::int,
      p.m[1]::int,
      p.m[2]::int,
      coalesce(p.m[4], '0')::int,
      coalesce(p.m[5], '0')::int,
      0.0
    ) at time zone 'Asia/Ho_Chi_Minh'
  )
end
from parsed as p
where w.id = p.id;

create index if not exists wholesale_leads_submitted_ts_idx
  on public.wholesale_leads (submitted_at_ts);

-- View public: bổ sung submitted_at_ts, giữ nguyên mọi cột cũ + grant anon.
create or replace view public.leads_public as
select
  id, batch_id, submission_id, submitted_at,
  raw_url, raw_first_source_url, first_user_source, first_user_medium,
  location, brands_raw, budget_raw, budget_bucket, registered_country, distribute_country,
  type_company, how_know, contact_pref, week_num, month_num, day_num,
  score, tier, gate_failed, spam_signals, geo_mismatch, severe_geo_mismatch,
  email_valid, phone_valid, duplicate_count, attribution_basis, contact_group, utm, seq,
  submitted_at_ts
from public.wholesale_leads;

revoke all on public.leads_public from anon, authenticated;
grant select on public.leads_public to anon;

-- Verify bắt buộc: dán kết quả 2 query này vào report.
-- Ngưỡng FAIL: unparsed/total > 1% hoặc unparsed > 50 thì DỪNG Phase B.
select
  count(*) as total,
  count(submitted_at_ts) as parsed,
  count(*) - count(submitted_at_ts) as unparsed
from public.wholesale_leads;
select submitted_at, count(*)
from public.wholesale_leads
where submitted_at_ts is null
  and nullif(trim(submitted_at), '') is not null
group by 1
order by 2 desc
limit 20;
