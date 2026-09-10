import { supabase } from '../lib/supabase';
export type HistoricalDayEvent = 'continuing' | 'check_in' | 'check_out' | 'moved_in' | 'moved_out' | 'returned' | 'left_for_absence';
export interface HistoricalSegment {
  physicalOccupancyId?: string | null;
  segmentId: string; stayId: string; dogId: string; dogName: string;
  lifecycleKind: 'single' | 'shared' | 'longstay'; roomId: string;
  usedFrom: string; usedUntil: string; displayFrom: string; displayUntil: string;
  selectedDayEvents: HistoricalDayEvent[]; provenanceStatus: 'verified'; coverageClassification: 'verified_supported_path';
}
export interface HistoricalBoard {
  selectedDate: string; timezone: 'Asia/Seoul'; evidenceAsOf: string; readOnly: true; coverageStatus: 'PARTIAL';
  rooms: {roomId: string; roomName: string; roomTypeId: string; roomType: string; segments: HistoricalSegment[]}[];
  unavailable: {stayId: string; dogId: string; dogName: string; lifecycleKind: string; reasonCode: string; affectedFrom: string; affectedUntil: string; coverageClassification: 'unavailable'}[];
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const instant = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const kinds = ['single', 'shared', 'longstay'];
const events = ['continuing', 'check_in', 'check_out', 'moved_in', 'moved_out', 'returned', 'left_for_absence'];
export function parseHistoricalBoard(data: unknown, date: string): HistoricalBoard {
  const ids = new Set<string>();
  const dayStart = Date.parse(`${date}T00:00:00+09:00`);
  const dayEnd = dayStart + 86_400_000;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dayStart) || !object(data) || data.selectedDate !== date || data.timezone !== 'Asia/Seoul' || data.readOnly !== true || data.coverageStatus !== 'PARTIAL' || !instant(data.evidenceAsOf)
    || !Array.isArray(data.rooms) || !Array.isArray(data.unavailable)
    || !data.rooms.every(r => object(r) && ['roomId','roomName','roomTypeId','roomType'].every(k => text(r[k])) && Array.isArray(r.segments) && r.segments.every((s: unknown) => {
      if (!object(s) || !['segmentId','stayId','dogId','dogName'].every(k => text(s[k])) || s.roomId !== r.roomId || !kinds.includes(s.lifecycleKind as string)
        || (s.physicalOccupancyId != null && !text(s.physicalOccupancyId))
        || s.provenanceStatus !== 'verified' || s.coverageClassification !== 'verified_supported_path'
        || !['usedFrom','usedUntil','displayFrom','displayUntil'].every(k => instant(s[k]))
        || !(Date.parse(s.usedFrom as string) <= Date.parse(s.displayFrom as string) && Date.parse(s.displayFrom as string) < Date.parse(s.displayUntil as string) && Date.parse(s.displayUntil as string) <= Date.parse(s.usedUntil as string))
        || Date.parse(s.displayFrom as string) < dayStart || Date.parse(s.displayUntil as string) > dayEnd
        || !Array.isArray(s.selectedDayEvents) || !s.selectedDayEvents.every(e => events.includes(e)) || ids.has(s.segmentId as string)) return false;
      ids.add(s.segmentId as string); return true;
    })) || new Set(data.rooms.map(r => r.roomId)).size !== data.rooms.length
    || !data.unavailable.every(u => object(u) && ['stayId','dogId','dogName','reasonCode'].every(k => text(u[k])) && kinds.includes(u.lifecycleKind as string) && u.coverageClassification === 'unavailable'
      && instant(u.affectedFrom) && instant(u.affectedUntil)
      && dayStart <= Date.parse(u.affectedFrom) && Date.parse(u.affectedFrom) < Date.parse(u.affectedUntil)
      && Date.parse(u.affectedUntil) <= Math.min(dayEnd, Date.parse(data.evidenceAsOf as string)))) {
    throw new Error('선택일 실제 객실 기록을 확인하지 못했습니다.');
  }
  return data as unknown as HistoricalBoard;
}
export async function fetchHistoricalBoard(date: string): Promise<HistoricalBoard> {
  const {data, error} = await supabase.rpc('get_hotel_historical_room_board', {p_local_date: date});
  if (error) throw new Error('선택일 실제 객실 기록을 확인하지 못했습니다.');
  return parseHistoricalBoard(data, date);
}
