begin;

create or replace function public.protect_dog_active_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active is distinct from old.is_active and not public.is_admin() then
    raise exception 'Only administrators can change dog active status.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_dog_active_status on public.dogs;
create trigger protect_dog_active_status
before update of is_active on public.dogs
for each row execute function public.protect_dog_active_status();

revoke all on function public.protect_dog_active_status() from public;

commit;
