-- Append-only contract repair: application optimistic conflicts must not use
-- PostgreSQL's retryable serialization_failure SQLSTATE (40001).
begin;

do $repair$
declare
  target record;
  source_before text;
  source_after text;
  definition_before text;
  definition_after text;
  execute_grantees text[];
begin
  for target in
    select * from (values
      ('public.set_operation_schedule_status(uuid,integer,text,text,uuid)', 'a757e6185ad5576a78864812d4b200ba', '1f7ac4529e2fd621b33f0855a071964e', array['authenticated','postgres','service_role']::text[])
    ) approved(identity, before_fingerprint, after_fingerprint, expected_acl)
  loop
    select p.prosrc, pg_get_functiondef(p.oid), coalesce(array(
      select distinct pg_get_userbyid(a.grantee)::text
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.privilege_type = 'EXECUTE' order by 1
    ), '{}')
    into source_before, definition_before, execute_grantees
    from pg_proc p
    where p.oid = to_regprocedure(target.identity);

    if source_before is null
       or md5(source_before) <> target.before_fingerprint
       or execute_grantees <> target.expected_acl
       or (length(source_before) - length(replace(source_before, 'using errcode = ''40001''', '')))
          / length('using errcode = ''40001''') <> 1
       or position('PT409' in source_before) > 0 then
      raise exception 'STOP_OPERATIONS_OPTIMISTIC_CONFLICT_REPAIR_GUARD: %', target.identity;
    end if;

    source_after := replace(source_before, 'using errcode = ''40001''', 'using errcode = ''PT409''');
    if md5(source_after) <> target.after_fingerprint then
      raise exception 'STOP_OPERATIONS_OPTIMISTIC_CONFLICT_REPAIR_SOURCE: %', target.identity;
    end if;

    definition_after := replace(definition_before, 'using errcode = ''40001''', 'using errcode = ''PT409''');
    if definition_after = definition_before then
      raise exception 'STOP_OPERATIONS_OPTIMISTIC_CONFLICT_REPAIR_REWRITE: %', target.identity;
    end if;
    execute definition_after;

    select p.prosrc, coalesce(array(
      select distinct pg_get_userbyid(a.grantee)::text
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.privilege_type = 'EXECUTE' order by 1
    ), '{}')
    into source_after, execute_grantees
    from pg_proc p where p.oid = to_regprocedure(target.identity);

    if md5(source_after) <> target.after_fingerprint
       or execute_grantees <> target.expected_acl then
      raise exception 'STOP_OPERATIONS_OPTIMISTIC_CONFLICT_REPAIR_POST_GUARD: %', target.identity;
    end if;
  end loop;
end;
$repair$;

commit;
