-- P&M OS Journal daycare-student marker V1.
-- This is an explicit Dog Master attribute. Existing business history is not inferred or rewritten.

begin;

alter table public.dogs
  add column if not exists is_daycare_student boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dogs'
      and column_name = 'is_daycare_student'
      and data_type = 'boolean'
      and is_nullable = 'NO'
      and column_default = 'false'
  ) then
    raise exception 'STOP_JOURNAL_DAYCARE_STUDENT_COLUMN_CONTRACT';
  end if;
end
$$;

comment on column public.dogs.is_daycare_student is
  'Explicit dog-scoped daycare student marker. Never inferred from sales, schedules, or journal history.';

commit;
