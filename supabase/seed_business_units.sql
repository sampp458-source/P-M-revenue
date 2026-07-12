begin;

insert into public.business_units (
  code,
  name,
  sort_order,
  is_active
)
values
  ('daycare', '유치원', 1, true),
  ('training', '교육센터', 2, true),
  ('hotel', '호텔', 3, true)
on conflict (code) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

commit;
