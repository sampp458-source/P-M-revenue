"""Local-only Production-schema clone concurrency rehearsal.

Requires synthetic QA fixtures (10000000-... ids) from the schema-clone rehearsal.
Uses Unix socket only; refuses non-QA actor and requires READ COMMITTED.
No network/Production connection, no secrets, no migration application.
"""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
import time
import uuid


def uid(n):
    return f'10000000-0000-4000-8000-{n:012d}'


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--socket', required=True)
    parser.add_argument('--port', required=True)
    parser.add_argument('--database', default='rehearsal')
    parser.add_argument('--psql', default='psql')
    parser.add_argument('--iterations', type=int, default=100)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    assert Path(args.socket).is_absolute() and Path(args.socket).is_dir(), 'Local Unix socket required'
    assert args.iterations >= 100, 'At least 100 repetitions per mode'
    connection = [args.psql, '-X', '-Atq', '-h', args.socket, '-p', args.port,
                  '-U', 'postgres', '-d', args.database, '-v', 'ON_ERROR_STOP=1', '--set=VERBOSITY=verbose']
    results = {'isolation': None, 'modes': {}, 'semantic_orders': [], 'errors': []}

    def execute(code, name='qa', check=True):
        pre = ("SET statement_timeout='10s'; SET lock_timeout='6s'; SET deadlock_timeout='50ms';"
               f"SET application_name={quote(name)}; SET request.jwt.claim.sub='{uid(1)}';")
        start = time.perf_counter()
        p = subprocess.run(connection, input=pre+code, text=True, capture_output=True)
        r = {'code': p.returncode, 'stdout': p.stdout.strip(), 'stderr': p.stderr.strip(),
             'ms': round((time.perf_counter()-start)*1000, 2)}
        if check and p.returncode:
            raise AssertionError(r)
        return r

    def sql(code):
        return execute(code)['stdout']

    assert sql(f"SELECT name LIKE 'QA%' FROM profiles WHERE id='{uid(1)}';") == 't', 'Synthetic QA fixture only'
    results['isolation'] = sql('SHOW default_transaction_isolation;')
    assert results['isolation'] == 'read committed'
    assert sql("SELECT count(*) FROM pg_constraint WHERE conrelid='notification_schedule_state'::regclass AND contype='f';") == '0'

    def create():
        return json.loads(sql(f"SET ROLE authenticated; SELECT create_operation_schedule('{uid(21)}','{uid(30)}','Concurrency QA',"
                             "'2026-10-10 10:00+09','2026-10-10 11:00+09',false,false,NULL,"
                             f"ARRAY['{uid(2)}'::uuid],'{{}}'::uuid[],'{{}}'::uuid[],gen_random_uuid());"))

    def update(s, request=None, assignee=3, title='Changed'):
        return (f"SELECT update_operation_schedule('{s['id']}',{s['version']},'{uid(21)}','{uid(30)}',"
                f"{quote(title)},'2026-10-10 10:00+09','2026-10-10 11:00+09',false,false,NULL,"
                f"ARRAY['{uid(assignee)}'::uuid],'{{}}'::uuid[],'{{}}'::uuid[],{quote(request or uuid.uuid4())});")

    def sync(s, target=None):
        array = "'{}'::uuid[]" if target is None else f"ARRAY['{uid(target)}'::uuid]"
        return f"SELECT sync_operation_schedule_links('{s['id']}',{array},'{{}}'::uuid[],'{{}}'::uuid[],'{uid(1)}');"

    def wait_sleep(name):
        deadline = time.monotonic()+4
        while time.monotonic() < deadline:
            if sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name={quote(name)} AND wait_event='PgSleep');") == 't':
                return
            time.sleep(.003)
        raise AssertionError('barrier not reached: '+name)

    def ordered_pair(a, b):
        name = 'qa_lock_'+uuid.uuid4().hex
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(execute, a, name, False)
            wait_sleep(name)
            second = pool.submit(execute, b, name+'_b', False)
            return [first.result(), second.result()]

    def events(s):
        return json.loads(sql(f"SELECT coalesce(jsonb_agg(jsonb_build_object('recipient',n.recipient_id,'kind',e.event_type,'key',e.dedupe_key) ORDER BY split_part(e.dedupe_key,':',3)::bigint),'[]') FROM notifications n JOIN notification_events e ON e.id=n.event_id WHERE n.deep_link_id='{s['id']}';"))

    def consistent(s):
        return sql(f"SELECT st.fingerprint= schedule_notification_fingerprint_v1(s) AND st.assignees=ARRAY(SELECT DISTINCT a.profile_id FROM operation_schedule_assignees a WHERE a.schedule_id=s.id AND a.archived_at IS NULL ORDER BY a.profile_id) AND st.status=s.status AND st.archived=(s.archived_at IS NOT NULL) FROM operation_schedules s JOIN notification_schedule_state st ON st.schedule_id=s.id WHERE s.id='{s['id']}';") == 't'

    def record(responses, summary):
        for r in responses:
            summary['transactions'] += 1
            if r['code'] == 0:
                summary['success'] += 1
            else:
                summary['deadlock'] += int('40P01' in r['stderr'])
                summary['timeout'] += int('55P03' in r['stderr'] or '57014' in r['stderr'])
                summary['serialization_failure'] += int('40001' in r['stderr'])
                results['errors'].append(r)
        assert all(r['code'] == 0 for r in responses), responses

    for enabled in [False, True]:
        sql('UPDATE notification_schedule_config SET enabled='+str(enabled).lower()+';')
        initial_counts = sql('SELECT count(*) FROM notification_events;')
        summary = dict(iterations=args.iterations, transactions=0, success=0, deadlock=0,
                       timeout=0, serialization_failure=0, duplicate_notification=0, state_mismatch=0)
        results['modes'][str(enabled)] = summary
        # Original exact inversion: actual parent update RPC against independent existing sync helper.
        for i in range(args.iterations):
            s = create()
            a = (f"BEGIN; SELECT id FROM operation_schedules WHERE id='{s['id']}' FOR UPDATE;"
                 'SELECT pg_sleep(.15); SET ROLE authenticated; '+update(s)+' COMMIT;')
            b = 'BEGIN; SET ROLE authenticated; '+sync(s)+' COMMIT;'
            record(ordered_pair(a, b), summary)
            assert consistent(s), s
            if enabled:
                assert [(e['recipient'], e['kind']) for e in events(s)] == [
                    (uid(2), 'SCHEDULE_ASSIGNED'), (uid(3), 'SCHEDULE_ASSIGNED')], events(s)
            if (i+1) % 25 == 0:
                print('original inversion', enabled, i+1, 'PASS', flush=True)
        # Identical request retries exercise the real domain idempotency path.
        s = create(); request = uuid.uuid4()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: execute('SET ROLE authenticated; '+update(s, request), check=False), range(4)))
        record(responses, summary); assert consistent(s)
        if enabled:
            assert len(events(s)) == 2, events(s)
        # Overlapping writes on the same schedule. Domain versions are selected under the existing parent lock.
        for kind in ['two_parent_updates', 'two_assignee_modifications', 'reassignment_vs_parent', 'complete_vs_assignee']:
            s = create()
            if kind == 'two_parent_updates':
                a = f"BEGIN; UPDATE operation_schedules SET title='First' WHERE id='{s['id']}'; SELECT pg_sleep(.15); COMMIT;"
                b = f"BEGIN; UPDATE operation_schedules SET title='Second' WHERE id='{s['id']}'; COMMIT;"
            elif kind == 'two_assignee_modifications':
                a = 'BEGIN; '+sync(s, 3)+' SELECT pg_sleep(.15); COMMIT;'
                b = 'BEGIN; '+sync(s)+' COMMIT;'
            else:
                assignment = "status='completed'" if kind == 'complete_vs_assignee' else "title='Time changed'"
                a = f"BEGIN; UPDATE operation_schedules SET {assignment} WHERE id='{s['id']}'; SELECT pg_sleep(.15); COMMIT;"
                b = 'BEGIN; '+sync(s, 3)+' COMMIT;'
            record(ordered_pair(a, b), summary); assert consistent(s)
            if enabled:
                ev = [(e['recipient'], e['kind']) for e in events(s)]
                expected = {
                    'two_parent_updates': [(uid(2),'SCHEDULE_ASSIGNED'),(uid(2),'SCHEDULE_UPDATED'),(uid(2),'SCHEDULE_UPDATED')],
                    'two_assignee_modifications': [(uid(2),'SCHEDULE_ASSIGNED'),(uid(3),'SCHEDULE_ASSIGNED')],
                    'reassignment_vs_parent': [(uid(2),'SCHEDULE_ASSIGNED'),(uid(3),'SCHEDULE_ASSIGNED'),(uid(3),'SCHEDULE_UPDATED')],
                    'complete_vs_assignee': [(uid(2),'SCHEDULE_ASSIGNED'),(uid(3),'SCHEDULE_ASSIGNED'),(uid(3),'SCHEDULE_COMPLETED')],
                }[kind]
                assert ev == expected, (kind, ev, expected)
                results['semantic_orders'].append({'kind':kind,'events':events(s),'state_match':True})
        # Ten independent schedules simultaneously hold their own mutex, proving no global mutex.
        sources = [create() for _ in range(10)]
        start = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            futures = [pool.submit(execute, f"BEGIN; UPDATE operation_schedules SET title='Parallel' WHERE id='{s['id']}'; SET CONSTRAINTS ALL IMMEDIATE; SELECT pg_sleep(.6); COMMIT;", 'qa_parallel_'+str(i), False) for i,s in enumerate(sources)]
            time.sleep(.2)
            concurrent_sleepers = int(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'qa_parallel_%' AND wait_event='PgSleep';"))
            responses = [f.result() for f in futures]
        record(responses, summary)
        summary['parallel_workers'] = 10
        summary['simultaneous_mutex_holders'] = concurrent_sleepers
        summary['parallel_ms'] = round((time.perf_counter()-start)*1000,2)
        assert concurrent_sleepers >= 5, 'unexpected global serialization'
        assert all(consistent(s) for s in sources)
        if not enabled:
            assert sql('SELECT count(*) FROM notification_events;') == initial_counts
            summary['off_event_delta'] = 0
        assert sql('SELECT count(*)-count(DISTINCT dedupe_key) FROM notification_events;') == '0'
        assert sql('SELECT count(*)-count(DISTINCT (event_id,recipient_id)) FROM notifications;') == '0'
        Path(args.output).write_text(json.dumps(results, indent=2))

    # Both commit orders with no domain locks acquired by finalizer after mutex.
    for first in ['parent_first','assignee_first']:
        s = create()
        parent = f"UPDATE operation_schedules SET title='Commit order changed' WHERE id='{s['id']}';"
        assign = sync(s, 3)
        a, b = (parent, assign) if first == 'parent_first' else (assign, parent)
        responses = ordered_pair('BEGIN; '+a+' SET CONSTRAINTS ALL IMMEDIATE; SELECT pg_sleep(.15); COMMIT;', 'BEGIN; '+b+' COMMIT;')
        assert all(r['code'] == 0 for r in responses), responses
        ev = [(e['recipient'], e['kind']) for e in events(s)]
        expected = [(uid(2),'SCHEDULE_ASSIGNED')] + (
            [(uid(2),'SCHEDULE_UPDATED'),(uid(3),'SCHEDULE_ASSIGNED')] if first == 'parent_first' else
            [(uid(3),'SCHEDULE_ASSIGNED'),(uid(3),'SCHEDULE_UPDATED')])
        assert ev == expected, (first, ev)
        assert consistent(s)
        results['semantic_orders'].append({'kind':first,'events':events(s),'state_match':True})
    results['result'] = 'PASS'
    Path(args.output).write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
