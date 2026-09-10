import { supabase } from '../lib/supabase';
export interface CompletedSharedStay {
  id: string; dogName: string; checkedOutAt: string;
  scheduleEvents: { eventKind: 'check_in' | 'check_out'; schedule: { id: string } }[];
}
export interface SharedHistorySegment {
  hotelStayId: string; dogName: string; roomId: string; roomName: string;
  usedFrom: string; usedUntil: string; displayFrom: string; displayUntil: string;
}
export interface SharedHistory {
  coverageStatus: 'SHARED_ONLY'; segments: SharedHistorySegment[];
  unavailableMembers: { hotelStayId: string; dogName: string; reasonCode: string }[];
}
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object';
const strings = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string' && Boolean((v[k] as string).trim()));
export async function fetchCompletedSharedStays(date: string): Promise<CompletedSharedStay[]> {
  const {data,error} = await supabase.rpc('get_completed_shared_hotel_stays',{p_local_date:date});
  if (error || !Array.isArray(data) || !data.every(v => object(v) && strings(v,['id','dogName','checkedOutAt']) && Array.isArray(v.scheduleEvents) && v.scheduleEvents.every((e: unknown) => object(e) && ['check_in','check_out'].includes(e.eventKind as string) && object(e.schedule) && strings(e.schedule,['id'])))) throw new Error('완료된 함께 투숙 기록을 확인하지 못했습니다.');
  if (new Set(data.map(v => v.id)).size !== data.length) throw new Error('완료 기록의 연결을 확인해야 합니다.');
  return data as CompletedSharedStay[];
}
export async function fetchSharedRoomHistory(date: string): Promise<SharedHistory> {
  const {data,error} = await supabase.rpc('get_hotel_shared_room_history',{p_local_date:date});
  if (error || !object(data) || data.coverageStatus !== 'SHARED_ONLY' || !Array.isArray(data.segments) || !Array.isArray(data.unavailableMembers)
    || !data.segments.every(v => object(v) && strings(v,['hotelStayId','dogName','roomId','roomName','usedFrom','usedUntil','displayFrom','displayUntil']) && Date.parse(v.displayFrom as string)<Date.parse(v.displayUntil as string))
    || !data.unavailableMembers.every(v => object(v) && strings(v,['hotelStayId','dogName','reasonCode']))) throw new Error('과거 함께 투숙 기록을 확인하지 못했습니다.');
  return data as unknown as SharedHistory;
}
