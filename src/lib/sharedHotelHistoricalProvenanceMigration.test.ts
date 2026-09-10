import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('../../supabase/',import.meta.url);
const read=(path:string)=>readFileSync(new URL(path,root),'utf8');
const sql=read('migrations/202609090001_shared_hotel_historical_provenance.sql');
describe('008 append-only Shared history contract',()=>{
 it('preserves immutable 004 and does not change table/security/command contracts',()=>{
 expect(createHash('sha256').update(read('migrations/202609080004_hotel_schedule_canonical_room_projection.sql')).digest('hex')).toBe('72957025e671738979d95c1ac7edad400b19ad2bbb47395ea00396e341a5460c');
 expect(sql).not.toMatch(/^\s*(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE|CREATE\s+TRIGGER|DROP\s|CREATE\s+OR\s+REPLACE)/im);
 expect(sql.match(/CREATE FUNCTION /g)).toHaveLength(6);
 });
 it('uses normalized allowlists, exact version continuity and normalized tail checks',()=>{
 expect(sql).toContain("coalesce(p_row->f.key,'null'::jsonb)");expect(sql).toContain("f.value->>'required'");
 expect(sql).toContain('public.hotel_shared_semantic_internal(p_entity,a');expect(sql).toContain('prior IS DISTINCT FROM public.hotel_shared_semantic_internal(p_entity,p_current)');
 });
 it('keeps old resolver in one batch and requires independent move proof',()=>{
 expect(sql.match(/base:=public.get_operation_hotel_room_projections\(/g)).toHaveLength(1);
 expect(sql).toContain("r->'response'->>'version'=x->>'version'");expect(sql).toContain("chains->'hotel_room_allocations'");
 expect(sql).not.toMatch(/perform public\.(move|complete|finish|claim)/i);
 });
 it('keeps verification read-only and runtime fixtures isolated with rollback',()=>{
 for(const kind of ['preflight','postflight']) { const s=read(`verification/202609090001_shared_hotel_historical_provenance_${kind}.sql`);expect(s).toContain('SET TRANSACTION READ ONLY');expect(s.trim().endsWith('ROLLBACK;')).toBe(true); }
 const qa=read('verification/202609090001_shared_hotel_historical_provenance_runtime_qa.sql');expect(qa).toContain('ISOLATED_FIXTURE_ONLY');expect(qa.trim().endsWith('ROLLBACK;')).toBe(true);
 });
});
