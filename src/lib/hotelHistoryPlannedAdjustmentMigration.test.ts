import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
const read=(p:string)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const tag='202609100002_hotel_history_planned_checkout_adjustment';
const sql=read(`supabase/migrations/${tag}.sql`);
describe('strict planned checkout follow-up',()=>{
 it('preserves applied original and limits changed functions',()=>{
 expect(createHash('sha256').update(read('supabase/migrations/202609100001_unified_hotel_historical_room_board.sql')).digest('hex')).toBe('c191cbcde9f9fd6641107e08723b8dff00b8fa65ae0dcd260fe09380b87f44e6');
 expect([...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION public\.(\w+)/g)].map(m=>m[1])).toEqual(['hotel_history_planned_adjustment_010','hotel_history_individual_010','get_hotel_historical_room_board']);
 expect(sql).not.toMatch(/\b(?:INSERT INTO|DELETE FROM|CREATE TABLE|CREATE TRIGGER|ALTER TABLE|CREATE POLICY)\b/i);
 });
 it('does not grant request table or new helper access',()=>{
 expect(sql).toContain('REVOKE ALL ON FUNCTION public.hotel_history_planned_adjustment_010(jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role');
 expect(sql).not.toMatch(/\bGRANT\b/);expect(sql).toContain("CASE WHEN kind='single' THEN ctx.planned_requests");expect(sql).toContain('longstay OR NOT public.hotel_history_planned_adjustment_010');
 });
 it('requires completed request, unique root, response allocation version and unique capacity edge',()=>{
 for(const part of ['matches=1','roots<>1','caps<>1','allocations<>1',"req->>'completed_at' IS NULL","sa->>'version' IS DISTINCT FROM n->>'version'","req->>'hotel_stay_id' IS DISTINCT FROM s->>'id'"])expect(sql).toContain(part);
 });
 it('has read-only catalog verification and exact replacement body hashes',()=>{
 const post=read(`supabase/verification/${tag}_postflight.sql`);
 for(const name of ['preflight','postflight']){const s=read(`supabase/verification/${tag}_${name}.sql`);expect(s).toContain('SET TRANSACTION READ ONLY');expect(s.trim().endsWith('ROLLBACK;')).toBe(true);expect(s).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);}
 for(const m of sql.matchAll(/AS \$\$([\s\S]*?)\$\$;/g))expect(post).toContain(createHash('md5').update(m[1].trim()).digest('hex'));
 });
 it('keeps local fixtures guarded and rolled back',()=>{
 const s=read(`supabase/verification/${tag}_runtime_qa.sql`);expect(s).toContain("current_database()<>'projection_fixture_010'");expect(s).toContain('inet_server_addr() IS NOT NULL');expect(s.trim().endsWith('ROLLBACK;')).toBe(true);
 });
});
