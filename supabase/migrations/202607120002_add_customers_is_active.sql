begin;

alter table public.customers
  add column if not exists is_active boolean not null default true;

commit;
