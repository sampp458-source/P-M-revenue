-- Restores only the approved Operations optimistic-version SQLSTATE variant.
begin;

do $rollback$
declare target record; source_before text; definition_before text; definition_after text; execute_grantees text[];
begin
  for target in select * from (values
    ('public.set_operation_schedule_status(uuid,integer,text,text,uuid)', '1f7ac4529e2fd621b33f0855a071964e', array['authenticated','postgres','service_role']::text[])
  ) approved(identity, body_fingerprint, expected_acl)
  loop
    select p.prosrc, pg_get_functiondef(p.oid), coalesce(array(
      select distinct pg_get_userbyid(a.grantee)::text
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.privilege_type = 'EXECUTE' order by 1
    ), '{}')
    into source_before, definition_before, execute_grantees
    from pg_proc p where p.oid = to_regprocedure(target.identity);

    if source_before is null or md5(source_before) <> target.body_fingerprint
       or execute_grantees <> target.expected_acl
       or (length(source_before) - length(replace(source_before, 'using errcode = ''PT409''', '')))
          / length('using errcode = ''PT409''') <> 1 then
      raise exception 'STOP_OPERATIONS_OPTIMISTIC_CONFLICT_ROLLBACK_GUARD: %', target.identity;
    end if;
    definition_after := replace(definition_before, 'using errcode = ''PT409''', 'using errcode = ''40001''');
    if definition_after = definition_before then
      raise exception 'STOP_OPERATIONS_OPTIMISTIC_CONFLICT_ROLLBACK_REWRITE: %', target.identity;
    end if;
    execute definition_after;
  end loop;
end;
$rollback$;

commit;
