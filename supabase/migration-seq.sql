-- Migration 002: thêm seq (vị trí dòng trong file) để ORDER BY ổn định.
-- Chạy trong Supabase SQL Editor sau migration.sql.
-- Lý do: PostgREST phân trang không ORDER BY trả về heap order không đảm bảo
-- (parallel scan), làm representative của contact group bị đổi → lệch tier (parity AC6).

alter table public.wholesale_leads add column if not exists seq int;

create or replace view public.leads_public as
select
  id, batch_id, submission_id, submitted_at,
  raw_url, raw_first_source_url, first_user_source, first_user_medium,
  location, brands_raw, budget_raw, budget_bucket, registered_country, distribute_country,
  type_company, how_know, contact_pref, week_num, month_num, day_num,
  score, tier, gate_failed, spam_signals, geo_mismatch, severe_geo_mismatch,
  email_valid, phone_valid, duplicate_count, attribution_basis, contact_group, utm, seq
from public.wholesale_leads;

-- CREATE OR REPLACE VIEW giữ nguyên grant SELECT cho anon, nhưng chạy lại cho chắc:
revoke all on public.leads_public from anon, authenticated;
grant select on public.leads_public to anon;
