-- Migration: wholesale lead persistence (review-plan v3 FIX-2/FIX-6/FIX-7)
-- Chạy trong Supabase SQL Editor (project xeitiijvywresnyjycpq).
-- Lưu ý: KHÔNG lưu g-recaptcha-response (token dùng 1 lần, nặng, vô giá trị phân tích).

-- 1. Batches: mỗi lần import 1 batch
create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_row_count int not null,
  inserted int not null default 0,
  updated int not null default 0,
  created_at timestamptz not null default now()
);

-- 2. Base table: 23/24 cột CSV (trừ recaptcha) + derived
create table if not exists public.wholesale_leads (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  submission_id text not null,
  submitted_at text not null default '',
  raw_url text not null default '',
  raw_first_source_url text not null default '',
  first_user_source text not null default '',
  first_user_medium text not null default '',
  location text not null default '',
  brands_raw text not null default '',
  budget_raw text not null default '',
  budget_bucket text not null default 'Below $5,000',
  registered_country text not null default '',
  distribute_country text not null default '',
  type_company text not null default 'Others',
  how_know text not null default '',
  -- PII: chỉ service_role được đọc
  company text not null default '',
  contact_name text not null default '',
  email text not null default '',
  calling_code text not null default '',
  phone_raw text not null default '',
  phone_e164 text not null default '',
  contact_pref text not null default '',
  website_raw text not null default '',
  week_num smallint null,
  month_num smallint null,
  day_num smallint null,
  -- Derived (tính bằng đúng transformRows ở import script, không tính bằng SQL)
  score smallint not null default 0,
  tier text not null default 'Review',
  gate_failed boolean not null default true,
  spam_signals text[] not null default '{}',
  geo_mismatch boolean not null default false,
  severe_geo_mismatch boolean not null default false,
  email_valid boolean not null default false,
  phone_valid boolean not null default false,
  duplicate_count int not null default 1,
  attribution_basis text not null default 'unknown',
  lead_key_hash text not null default '',
  -- Nhóm contact ngẫu nhiên (UUID) để frontend dedupe mà không lộ hash PII.
  -- Cùng contact trong 1 batch → cùng contact_group; khác batch → khác group
  -- (KHÔNG link xuyên batch). UUID ngẫu nhiên nên không đảo ngược ra email/phone;
  -- thông tin duy nhất nó lộ ("2 dòng cùng contact") đã lộ qua duplicateCount > 1.
  -- Xem FIX-7: lead_key_hash (PII-derived) bị LOẠI khỏi view, contact_group ở lại
  -- vì uniqueContacts/duplicateGroups cần key ổn định trong batch.
  contact_group uuid not null default gen_random_uuid(),
  utm jsonb not null default '{"submit":{"source":"","medium":"","term":"","content":"","campaign":""},"first_touch":{"source":"","medium":"","term":"","content":"","campaign":""},"chosen":{"source":"","medium":"","term":"","content":"","campaign":""}}',
  created_at timestamptz not null default now(),
  unique (batch_id, submission_id)
);

create index if not exists wholesale_leads_batch_idx on public.wholesale_leads (batch_id);
create index if not exists wholesale_leads_tier_idx on public.wholesale_leads (tier);
create index if not exists wholesale_leads_country_idx on public.wholesale_leads (registered_country);

-- 3. RLS: bật, KHÔNG policy cho anon/authenticated, REVOKE explicit
alter table public.wholesale_leads enable row level security;
alter table public.batches enable row level security;
revoke all on public.wholesale_leads from anon, authenticated;
revoke all on public.batches from anon, authenticated;
-- service_role bypass RLS nên seed script đọc/ghi base table bình thường.

-- 4. Public view: security-definer mặc định (owner), liệt kê cột explicit.
-- Loại trừ PII: company, contact_name, email, calling_code, phone_raw,
-- phone_e164, website_raw + lead_key_hash (PII-derived, FIX-7).
create or replace view public.leads_public as
select
  id, batch_id, submission_id, submitted_at,
  raw_url, raw_first_source_url, first_user_source, first_user_medium,
  location, brands_raw, budget_raw, budget_bucket, registered_country, distribute_country,
  type_company, how_know, contact_pref, week_num, month_num, day_num,
  score, tier, gate_failed, spam_signals, geo_mismatch, severe_geo_mismatch,
  email_valid, phone_valid, duplicate_count, attribution_basis, contact_group, utm
from public.wholesale_leads;

revoke all on public.leads_public from anon, authenticated;
grant select on public.leads_public to anon;
