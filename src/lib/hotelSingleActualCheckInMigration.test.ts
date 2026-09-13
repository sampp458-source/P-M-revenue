import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const root=new URL('../../supabase/',import.meta.url);
const sql=readFileSync(new URL('migrations/202609110001_hotel_single_actual_check_in.sql',root),'utf8');
describe('016 additive command contract',()=>{
 it('adds only receipt and new functions, preserving existing writers',()=>{
  expect(sql.match(/CREATE TABLE /g)).toHaveLength(1);
  expect(sql).not.toMatch(/CREATE OR REPLACE|CREATE TRIGGER|DROP |UPDATE public.hotel_capacity_reservations|UPDATE public.operation_schedules/);
  expect(sql).toContain('request_id uuid PRIMARY KEY');
  expect(sql).toContain('FROM PUBLIC, anon, authenticated');
 });
 it('replays before current state/version and locks room before revalidation',()=>{
  const command=sql.slice(sql.indexOf('CREATE FUNCTION public.check_in_unassigned'));
  const ordered=['pg_advisory_xact_lock','SELECT * INTO receipt','RETURN receipt.response','SELECT * INTO s','SELECT * INTO c','s.version<>p_expected_version',"'hotel-room:'",'evidence:=','assert_hotel_room_allocation_available','INSERT INTO public.hotel_room_allocations','UPDATE public.hotel_stays','INSERT INTO public.hotel_single_check_in_receipts'];
  let previous=-1;for(const token of ordered){const at=command.indexOf(token);expect(at,token).toBeGreaterThan(previous);previous=at;}
 });
 it('shares exact half-open conflict predicate and preserves planned boundaries',()=>{
  expect(sql).toContain('a.allocated_from<c.reserved_until AND a.allocated_until>lo');
  expect(sql).toContain("WHEN p_purpose='preassign' THEN c.reserved_from ELSE p_effective_at");
  expect(sql).toContain('VALUES(c.id,p_room_id,p_checked_in_at,c.reserved_until');
 });
 it.each(['preflight','postflight'])('keeps %s read only',kind=>{
  const s=readFileSync(new URL(`verification/202609110001_hotel_single_actual_check_in_${kind}.sql`,root),'utf8');
  expect(s.startsWith('BEGIN TRANSACTION READ ONLY;')).toBe(true);expect(s.trim().endsWith('ROLLBACK;')).toBe(true);
 });
});
