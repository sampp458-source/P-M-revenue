-- Restores only the approved Long Stay optimistic-version SQLSTATE variant.
begin;

do $rollback$
declare target record; definition_before text; definition_after text; source_before text;
begin
  for target in select * from (values
    ('public.confirm_long_stay_month(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid,uuid,uuid[],text,uuid)', '64d86aa3e90d8261eaf7f716a9ed5280'),
    ('public.complete_long_stay_check_in(uuid,integer,integer,timestamp with time zone,text,uuid)', '5a6a7f0517cc96fc41cd879f8b225dad'),
    ('public.start_long_stay_absence(uuid,integer,timestamp with time zone,timestamp with time zone,text,text,uuid)', 'f259871ca7c00b73350ab6fb9c093513'),
    ('public.complete_long_stay_absence(uuid,integer,timestamp with time zone,text,text,uuid)', '63c736cc71749d1c550995cf0838980c'),
    ('public.set_long_stay_planned_checkout(uuid,integer,date,uuid,uuid,time without time zone,boolean,uuid[],text,uuid)', '1f23bc6c2044a17c05f0e34793676842'),
    ('public.complete_long_stay_check_out(uuid,integer,integer,timestamp with time zone,text,uuid)', 'ed8c217933f42b4f286f1627babf833c'),
    ('public.reverse_long_stay_completion(uuid,integer,integer,text,uuid)', '3b13b37eff7980efb99636695805499e')
  ) approved(identity, body_fingerprint)
  loop
    select p.prosrc, pg_get_functiondef(p.oid) into source_before, definition_before
    from pg_proc p where p.oid = to_regprocedure(target.identity);
    if source_before is null or md5(source_before) <> target.body_fingerprint
       or (length(source_before) - length(replace(source_before, 'using errcode=''PT409''', '')))
          / length('using errcode=''PT409''') <> 1 then
      raise exception 'STOP_LONG_STAY_VERSION_CONFLICT_ROLLBACK_GUARD: %', target.identity;
    end if;
    definition_after := replace(definition_before, 'using errcode=''PT409''', 'using errcode=''40001''');
    if definition_after = definition_before then
      raise exception 'STOP_LONG_STAY_VERSION_CONFLICT_ROLLBACK_REWRITE: %', target.identity;
    end if;
    execute definition_after;
  end loop;
end;
$rollback$;

commit;
