-- Append-only contract repair: distinguish application optimistic conflicts
-- from genuine PostgreSQL serialization failures.
begin;

do $repair$
declare
  target record;
  definition_before text;
  definition_after text;
  source_before text;
  source_after text;
  execute_grantees text[];
begin
  for target in
    select * from (values
      ('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)', 'b5c84bb83b7c3091e60e6eae876cc7da', '64d86aa3e90d8261eaf7f716a9ed5280'),
      ('public.complete_long_stay_check_in(uuid,integer,integer,timestamp with time zone,text,uuid)', '591a667ecf68b7cda59805dbece4e2bf', '5a6a7f0517cc96fc41cd879f8b225dad'),
      ('public.start_long_stay_absence(uuid,integer,timestamp with time zone,timestamp with time zone,text,text,uuid)', '02c06fb2a159adc2f1656254f30f4d38', 'f259871ca7c00b73350ab6fb9c093513'),
      ('public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)', '82a57a24ca283bbc848af7f248ae57b8', '63c736cc71749d1c550995cf0838980c'),
      ('public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid[],text,uuid)', '20a20262edb54e4638acc31e823f7f86', '1f23bc6c2044a17c05f0e34793676842'),
      ('public.complete_long_stay_check_out(uuid,integer,integer,timestamp with time zone,text,uuid)', '1742cc4ea2c30f5a6955dc49e606caa0', 'ed8c217933f42b4f286f1627babf833c'),
      ('public.reverse_long_stay_completion(uuid,integer,integer,text,uuid)', 'd049bb24e4b8062b9bc3b20f90204970', '3b13b37eff7980efb99636695805499e')
    ) approved(identity, before_fingerprint, after_fingerprint)
  loop
    select p.prosrc, pg_get_functiondef(p.oid),
      coalesce(array(
        select distinct pg_get_userbyid(a.grantee)::text
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.privilege_type = 'EXECUTE'
        order by 1
      ), '{}')
    into source_before, definition_before, execute_grantees
    from pg_proc p
    where p.oid = to_regprocedure(target.identity);

    if source_before is null
       or md5(source_before) <> target.before_fingerprint
       or execute_grantees <> array['authenticated','postgres','service_role']::text[]
       or (length(source_before) - length(replace(source_before, 'using errcode=''40001''', '')))
          / length('using errcode=''40001''') <> 1
       or position('PT409' in source_before) > 0 then
      raise exception 'STOP_LONG_STAY_VERSION_CONFLICT_CONTRACT_REPAIR_GUARD: %', target.identity;
    end if;

    source_after := replace(source_before, 'using errcode=''40001''', 'using errcode=''PT409''');
    if md5(source_after) <> target.after_fingerprint then
      raise exception 'STOP_LONG_STAY_VERSION_CONFLICT_CONTRACT_REPAIR_SOURCE: %', target.identity;
    end if;

    definition_after := replace(
      definition_before,
      'using errcode=''40001''',
      'using errcode=''PT409'''
    );
    if definition_after = definition_before then
      raise exception 'STOP_LONG_STAY_VERSION_CONFLICT_CONTRACT_REPAIR_REWRITE: %', target.identity;
    end if;
    execute definition_after;
  end loop;

  if exists (
    select 1
    from (values
      ('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)', '64d86aa3e90d8261eaf7f716a9ed5280'),
      ('public.complete_long_stay_check_in(uuid,integer,integer,timestamp with time zone,text,uuid)', '5a6a7f0517cc96fc41cd879f8b225dad'),
      ('public.start_long_stay_absence(uuid,integer,timestamp with time zone,timestamp with time zone,text,text,uuid)', 'f259871ca7c00b73350ab6fb9c093513'),
      ('public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)', '63c736cc71749d1c550995cf0838980c'),
      ('public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid[],text,uuid)', '1f23bc6c2044a17c05f0e34793676842'),
      ('public.complete_long_stay_check_out(uuid,integer,integer,timestamp with time zone,text,uuid)', 'ed8c217933f42b4f286f1627babf833c'),
      ('public.reverse_long_stay_completion(uuid,integer,integer,text,uuid)', '3b13b37eff7980efb99636695805499e')
    ) expected(identity, body_fingerprint)
    join pg_proc p on p.oid = to_regprocedure(expected.identity)
    where md5(p.prosrc) <> expected.body_fingerprint
       or position('using errcode=''40001''' in p.prosrc) > 0
       or (length(p.prosrc) - length(replace(p.prosrc, 'using errcode=''PT409''', '')))
          / length('using errcode=''PT409''') <> 1
  ) then
    raise exception 'STOP_LONG_STAY_VERSION_CONFLICT_CONTRACT_REPAIR_POST_GUARD';
  end if;
end;
$repair$;

commit;
