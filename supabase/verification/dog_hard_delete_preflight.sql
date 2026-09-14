-- READ ONLY. Run manually before release; this does not grant permissions or delete data.
begin transaction read only;
with refs as (
  select c.conname, c.conrelid::regclass::text as source_table,
    c.confdeltype, c.convalidated, pg_get_constraintdef(c.oid) as definition
  from pg_constraint c
  where c.contype = 'f' and c.confrelid = 'public.dogs'::regclass
), checks as (
  select 'REFERENCES_BLOCK_DELETE' as check_name,
    count(*) >= 9 and bool_and(confdeltype in ('a','r') and convalidated) as pass,
    jsonb_agg(to_jsonb(refs)) as detail from refs
  union all
  select 'DOG_RLS', relrowsecurity, '{}'::jsonb
  from pg_class where oid = 'public.dogs'::regclass
  union all
  select 'DELETE_ACL', has_table_privilege('authenticated','public.dogs','DELETE'), '{}'::jsonb
  union all
  select 'ADMIN_ONLY_DELETE_POLICY', count(*) = 1
    and bool_and(polname = 'dogs_delete_admin' and pg_get_expr(polqual,polrelid) = 'is_admin()'
      and polroles = array['authenticated'::regrole::oid]),
    jsonb_agg(jsonb_build_object('policy',polname,'using',pg_get_expr(polqual,polrelid)))
  from pg_policy where polrelid = 'public.dogs'::regclass and polcmd in ('d','*')
  union all
  select 'NO_DOG_DELETE_TRIGGER_SIDE_EFFECTS', count(*) = 0,
    coalesce(jsonb_agg(tgname),'[]'::jsonb)
  from pg_trigger where tgrelid = 'public.dogs'::regclass and not tgisinternal
    and tgenabled <> 'D' and (tgtype::integer & 8) <> 0
)
select check_name, case when pass then 'PASS' else 'FAIL' end as status, detail from checks
order by check_name;
rollback;
