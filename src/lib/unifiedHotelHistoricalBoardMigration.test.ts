import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=(p:string)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const tag='202609100001_unified_hotel_historical_room_board';
const migration=read(`supabase/migrations/${tag}.sql`);
const pre=read(`supabase/verification/${tag}_preflight.sql`);
const post=read(`supabase/verification/${tag}_postflight.sql`);
const qa=read(`supabase/verification/${tag}_runtime_qa.sql`);
describe('010 append-only read contract',()=>{
 it('preserves immutable 004 and 008 migration bytes',()=>{
  for(const [file,sha] of [['202609080004_hotel_schedule_canonical_room_projection','72957025e671738979d95c1ac7edad400b19ad2bbb47395ea00396e341a5460c'],['202609090001_shared_hotel_historical_provenance','6e1626ebe1e22c798afb6947e5c9e17f1fb5362405915f021df849b8f44b5e81']]) expect(createHash('sha256').update(read(`supabase/migrations/${file}.sql`)).digest('hex')).toBe(sha);
 });
 it('only introduces the approved five read functions',()=>{
  expect([...migration.matchAll(/CREATE FUNCTION public\.(\w+)/g)].map(m=>m[1])).toEqual(['hotel_history_semantic_010','hotel_history_chain_010','hotel_history_individual_010','hotel_history_shared_gate_010','get_hotel_historical_room_board']);
  expect(migration).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|CREATE\s+(?:TABLE|TRIGGER)|ALTER\s+|DROP\s+|CREATE OR REPLACE)\b/i);
  expect(migration).toContain('STABLE SECURITY DEFINER SET search_path=public,pg_temp');
  expect(migration).toContain('auth.uid() IS NULL OR NOT public.is_active_operation_member()');
  expect(migration).toContain('REVOKE ALL ON FUNCTION public.hotel_history_individual_010(jsonb) FROM PUBLIC,anon,authenticated,service_role');
 });
 it('uses catalog-only verification and exact runtime body parity',()=>{
  for(const sql of [pre,post]){expect(sql).toContain('SET TRANSACTION READ ONLY');expect(sql.trim().endsWith('ROLLBACK;')).toBe(true);expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);}
  for(const body of migration.matchAll(/CREATE FUNCTION public\.[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)) expect(post).toContain(createHash('md5').update(body[1].trim()).digest('hex'));
 });
 it('keeps processing timestamps out of actual-use arithmetic',()=>{
  const resolver=migration.split('CREATE FUNCTION public.hotel_history_individual_010')[1].split('CREATE FUNCTION public.hotel_history_shared_gate_010')[0];
  expect(resolver).not.toMatch(/->>\s*'(created_at|updated_at|archived_at)'\)\s*::timestamptz/);
  expect(resolver).toContain("prev->>'allocated_until'");expect(resolver).toContain("a->>'request_id'");expect(resolver).toContain("r->'canonical_payload'->>'returnedAt'");
  expect(migration).toContain("IN ('move','merge_existing_stays')");
 });
 it('isolates synthetic SQL fixtures behind database and socket guards',()=>{
  expect(qa).toContain("current_database()<>'projection_fixture_010'");expect(qa).toContain('inet_server_addr() IS NOT NULL');expect(qa.trim().endsWith('ROLLBACK;')).toBe(true);
 });
 it('limits new consumer calls to PAST with no physical-source replacement',()=>{
  const page=read('src/pages/HotelOperations.tsx');expect(page).toContain('isPast ? fetchHistoricalBoard(selectedDate) : Promise.resolve(undefined)');
  const board=read('src/pages/HotelRoomBoard.tsx');expect(board).toContain('if (readOnly) {\n      const historicalRoom = historicalBoard?.rooms.find');
  expect(board).toContain('historyRoom={historicalRoom}');expect(board).toContain('onDragEnd={readOnly ? undefined : endDrag}');
  expect(board).not.toContain('if (readOnly) return <Card>');
  expect(board).toContain('activeHotelAllocation');expect(board).toContain('{completedPanel}');
 });
 it('date-scope fix preserves every internal resolver body',()=>{
  const expected: Record<string,string>={"hotel_history_semantic_010": "495911574658c974f175f9df425d8660979106c43728094979703a55e384cd8c", "hotel_history_chain_010": "bbe452304380cb6cb0ec07023f949ac8e0fd5b85976cd9b735f42db10de951eb", "hotel_history_individual_010": "bf10080054d8b8398004686199929484dbd9fce6023ed5ed4fc4ea00025b17cb", "hotel_history_shared_gate_010": "5dfa22e97f633564e8adfa23522382f06d1f94f410aee1498099aa39b71776e5"};
  for(const m of migration.matchAll(/CREATE FUNCTION public\.(hotel_history_\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)) expect(createHash('sha256').update(m[2]).digest('hex')).toBe(expected[m[1]]);
 });

});
