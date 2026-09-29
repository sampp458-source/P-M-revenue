// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {HotelRoomBoard} from './HotelRoomBoard';
import type {HotelOperationsSnapshot, HotelStay, HotelUnassignedClassification} from './hotelOperationsRepository';
import {hotelUnassignedClassificationPresentation} from './hotelUnassignedClassificationPresentation';

vi.mock('./hotelOperationsRepository', async original => ({
  ...await original<typeof import('./hotelOperationsRepository')>(),
  getHotelSingleRoomEligibility: vi.fn(async (stayId: string) => ({stayId, rooms: [{roomId: 'room', eligible: true}]})),
}));
afterEach(cleanup);
const date = '2026-09-29';
function guest(id: string, startsAt = '2026-09-29T09:00:00Z'): HotelStay {
  return {id, dogId:'same-dog', dogName:id, customerId:'customer', customerName:'fixture', customerPhone:null,
    version:2, requestId:id, checkedInAt:null, checkedInBy:null, checkedOutAt:null, checkedOutBy:null,
    createdBy:'staff', createdAt:startsAt, updatedAt:startsAt, archivedAt:null,
    capacityReservation:{id:`capacity-${id}`, roomTypeId:'deluxe', roomTypeCode:'DELUXE',roomTypeName:'DELUXE',
      reservedFrom:startsAt,reservedUntil:'2026-10-15T09:00:00Z',quantity:1},roomAllocations:[],
    scheduleEvents:[{eventKind:'check_in',schedule:{id:`event-${id}`,title:'입실',memo:null,startsAt,endsAt:startsAt,
      timeUnspecified:false,status:'scheduled',calendarId:'calendar',scheduleTypeId:'hotel',assignees:[]}}]};
}
function fixture(classifications: HotelUnassignedClassification[] = [], future = 0): HotelOperationsSnapshot {
  const stays = classifications.map((kind,i) => ({...guest(`예약-${i}`),
    checkedInAt: kind === 'CHECKED_IN_UNRESOLVED' || kind === 'LONG_STAY_RETURN' ? '2026-09-27T09:00:00Z' : null}));
  return {date,stays,unassignedFuture:Array.from({length:future},(_,i)=>guest(`향후-${i}`,'2026-10-09T09:00:00Z')),
    rooms:[{id:'room',name:'DELUXE 1',roomTypeId:'deluxe',roomTypeCode:'DELUXE',roomTypeName:'DELUXE',isActive:true,sortOrder:1}],
    roomTypes:[{id:'deluxe',code:'DELUXE',name:'DELUXE',activeRooms:6,reservedPeak:1,reservedNow:1,allocatedNow:0,checkedInNow:0,unassignedNow:stays.length,physicallyEmpty:6}],settings:null,
    selectedDateUnassigned:{date,count:stays.length,singleStayIds:stays.map(s=>s.id),sharedGroupIds:[],
      items:stays.map((s,i)=>({kind:'single',canonicalId:s.id,classification:classifications[i],capacitySegments:[]}))}};
}
function props(snapshot: HotelOperationsSnapshot, today = false) {
  return {snapshot,selectedDate:snapshot.date,dateMode:today ? 'TODAY' as const : 'FUTURE' as const,
    selectedDateIsToday:today,processing:false,allowCrossTypeChange:false,onOpenStay:vi.fn(),onDropStay:vi.fn(),onUnassignStay:vi.fn()};
}
describe('server classified assignment presentation', () => {
  it.each([true,false])('arrival quick link focuses arrival, not unassign, today=%s', today => {
    render(<HotelRoomBoard {...props(fixture(['ARRIVAL']),today)}/>);
    const scroll=vi.fn();Element.prototype.scrollIntoView=scroll;
    const button=screen.getByRole('button',{name:`${today?'오늘':'선택일'} 입실 · 배정 필요 1`});
    const target=screen.getByRole('region',{name:`${today?'오늘':'선택일'} 입실 · 객실 배정 필요`});
    expect(button).toHaveAttribute('aria-controls',target.id);
    fireEvent.click(button);expect(target).toHaveFocus();expect(scroll).toHaveBeenCalled();
    expect(screen.queryByRole('button',{name:'미배정 업무 보기'})).toBeNull();
  });
  it('mixed classification has distinct arrival and exception anchors with broad count preserved',()=>{
    render(<HotelRoomBoard {...props(fixture(['ARRIVAL','LATE_ARRIVAL','CHECKED_IN_UNRESOLVED']),true)}/>);
    Element.prototype.scrollIntoView=vi.fn();
    const arrival=screen.getByRole('button',{name:'오늘 입실 · 배정 필요 1'});
    const other=screen.getByRole('button',{name:'확인 필요 2'});
    expect(arrival.getAttribute('aria-controls')).not.toBe(other.getAttribute('aria-controls'));
    fireEvent.click(other);expect(document.getElementById(other.getAttribute('aria-controls')!)).toHaveFocus();
    expect(within(screen.getByLabelText('선택일 계획 요약')).getByText('미배정').parentElement).toHaveTextContent('3건');
    expect(screen.queryByText('객실 배정을 해제하려면 객실 카드를 이곳으로 옮기세요.')).not.toBeInTheDocument();
  });
  it('zero selected-date count has no unassigned links but preserves future 4',()=>{
    render(<HotelRoomBoard {...props(fixture([],4),true)}/>);
    const nav=within(screen.getByRole('navigation',{name:'보조 운영 바로가기'}));
    expect(nav.queryByRole('button',{name:/미배정 업무 보기|배정 필요|확인 필요/})).toBeNull();
    expect(nav.getByRole('button',{name:'향후 입실 · 객실 미배정 4'})).toBeEnabled();
  });
  it.each(['missing','stale','missing-classification'] as const)('untrusted %s classification links to fallback without inferring arrival',mode=>{
    const value=fixture(['ARRIVAL']);
    if(mode==='missing') delete value.selectedDateUnassigned;
    else if(mode==='stale') value.selectedDateUnassigned!.date='2026-09-28';
    else delete value.selectedDateUnassigned!.items[0].classification;
    render(<HotelRoomBoard {...props(value,true)}/>);Element.prototype.scrollIntoView=vi.fn();
    const link=screen.getByRole('button',{name:'미배정 확인 필요'});
    fireEvent.click(link);expect(document.getElementById(link.getAttribute('aria-controls')!)).toHaveFocus();
    expect(screen.queryByRole('button',{name:/입실 · 배정 필요/})).toBeNull();
  });
  it.each([true,false])('uses only ARRIVAL, above rooms, with today=%s', today => {
    const value=fixture(['ARRIVAL','LATE_ARRIVAL']);render(<HotelRoomBoard {...props(value,today)}/>);
    const arrival=screen.getByRole('region',{name:`${today?'오늘':'선택일'} 입실 · 객실 배정 필요`});
    expect(arrival).toHaveTextContent('예약-0');expect(arrival).not.toHaveTextContent('예약-1');
    expect(arrival).not.toHaveTextContent('호실 미배정');expect(arrival).not.toHaveTextContent('미처리');
    const room=screen.getByRole('region',{name:'DELUXE Room Board'});
    expect(arrival.compareDocumentPosition(room)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('region',{name:'입실 확인 필요'})).toHaveTextContent('예약-1');
    expect(within(screen.getByLabelText('선택일 계획 요약')).getByText('미배정').parentElement).toHaveTextContent('2건');
  });
  it.each([
    ['CHECKED_IN_UNRESOLVED','객실 점유 확인 필요'],['LONG_STAY_RETURN','복귀 · 객실 배정 필요'],
    ['LATE_ARRIVAL','입실 확인 필요'],['PLANNED_STAY_UNASSIGNED','숙박 예정 · 객실 배정 필요'],['OTHER','객실 배정 확인 필요'],
  ] as const)('routes %s without claiming normal arrival', (kind,label) => {
    render(<HotelRoomBoard {...props(fixture([kind]))}/>);
    expect(screen.queryByRole('region',{name:/^(오늘|선택일) 입실 ·/})).not.toBeInTheDocument();
    expect(screen.getByRole('region',{name:label})).toHaveTextContent('예약-0');
  });
  it('future prior-arrival plan is separate from actual lateness and counts in non-arrival navigation',()=>{
    const value=fixture(['PLANNED_STAY_UNASSIGNED']);
    value.date='2026-09-30';value.selectedDateUnassigned!.date=value.date;
    // Server evidence: observed before 9/29 18:00; selected day is 9/30.
    value.selectedDateUnassigned!.items[0].canonicalArrivalAt='2026-09-29T09:00:00Z';
    render(<HotelRoomBoard {...props(value)}/>);
    expect(screen.getByRole('region',{name:'숙박 예정 · 객실 배정 필요'})).toHaveTextContent('예약-0');
    expect(screen.queryByRole('region',{name:'입실 확인 필요'})).toBeNull();
    expect(screen.queryByRole('region',{name:/^(오늘|선택일) 입실 ·/})).toBeNull();
    expect(screen.getByRole('button',{name:'확인 필요 1'})).toBeVisible();
    expect(screen.queryByRole('button',{name:'미배정 확인 필요'})).toBeNull();
  });
  it('shows genuine overdue server evidence under the late heading without reclassifying on the client',()=>{
    const value=fixture(['LATE_ARRIVAL']);
    value.selectedDateUnassigned!.items[0].canonicalArrivalAt='2026-09-28T09:00:00Z';
    value.selectedDateUnassigned!.items[0].classificationReasonCode='CANONICAL_INITIAL_CHECK_IN_ACTUALLY_OVERDUE';
    render(<HotelRoomBoard {...props(value)}/>);
    expect(screen.getByRole('region',{name:'입실 확인 필요'})).toHaveTextContent('예약-0');
    expect(screen.queryByRole('region',{name:'숙박 예정 · 객실 배정 필요'})).toBeNull();
  });
  it('keeps all six classifications in the broad count and planned in exception navigation',()=>{
    const value=fixture(['ARRIVAL','LATE_ARRIVAL','PLANNED_STAY_UNASSIGNED','LONG_STAY_RETURN','CHECKED_IN_UNRESOLVED','OTHER']);
    render(<HotelRoomBoard {...props(value,true)}/>);
    expect(screen.getByRole('button',{name:'오늘 입실 · 배정 필요 1'})).toBeVisible();
    expect(screen.getByRole('button',{name:'확인 필요 5'})).toBeVisible();
    expect(within(screen.getByLabelText('선택일 계획 요약')).getByText('미배정').parentElement).toHaveTextContent('6건');
  });
  it('hides zero arrival and zero future without a large empty panel',()=>{
    render(<HotelRoomBoard {...props(fixture())}/>);
    expect(screen.queryByRole('region',{name:/입실 · 객실 배정 필요/})).toBeNull();
    expect(screen.queryByRole('region',{name:'향후 입실 미배정'})).toBeNull();
    expect(screen.queryByText('현재 미배정 예약이 없습니다.')).toBeNull();
  });
  it('future starts expanded, can collapse, and expands again on date change',()=>{
    const value=fixture([],2);const view=render(<HotelRoomBoard {...props(value)}/>);
    const future=screen.getByRole('region',{name:'향후 입실 미배정'});
    expect(future).toHaveTextContent('향후 입실 · 객실 미배정');
    expect(within(future).getByText('향후-0')).toBeVisible();
    fireEvent.click(within(future).getByRole('button',{name:'접기'}));
    expect(within(future).queryByText('향후-0')).toBeNull();
    view.rerender(<HotelRoomBoard {...props({...value,date:'2026-09-30',selectedDateUnassigned:{...value.selectedDateUnassigned!,date:'2026-09-30'}})}/>);
    expect(within(future).getByText('향후-0')).toBeVisible();
    expect(within(future).getByRole('button',{name:'접기'})).toHaveAttribute('aria-expanded','true');
  });
  it('does not infer arrival from timestamps when classification missing, invalid, or date stale',()=>{
    const value=fixture(['ARRIVAL']);delete value.selectedDateUnassigned!.items[0].classification;
    expect(hotelUnassignedClassificationPresentation(value,date).groups.OTHER).toHaveLength(1);
    value.selectedDateUnassigned!.items[0].classification='UNRECOGNIZED' as HotelUnassignedClassification;
    expect(hotelUnassignedClassificationPresentation(value,date).groups.OTHER).toHaveLength(1);
    value.selectedDateUnassigned!.items[0].classification='ARRIVAL';value.selectedDateUnassigned!.date='2026-09-28';
    render(<HotelRoomBoard {...props(value)}/>);
    expect(screen.queryByRole('region',{name:/입실 · 객실 배정 필요/})).toBeNull();
    expect(screen.getByText('선택일 분류 확인 필요')).toBeVisible();
    expect(screen.getByRole('region',{name:'분류 미확인 예약'})).toHaveTextContent('예약-0');
  });
  it('preserves distinct stays of one dog and all canonical broad units',()=>{
    const value=fixture(['ARRIVAL','ARRIVAL','OTHER','LONG_STAY_RETURN','CHECKED_IN_UNRESOLVED']);
    const result=hotelUnassignedClassificationPresentation(value,date);
    expect(result.groups.ARRIVAL.map(item=>item.canonicalId)).toEqual(['예약-0','예약-1']);
    expect(Object.values(result.groups).flat()).toHaveLength(value.selectedDateUnassigned!.count);
  });
  it('restores grouping to OTHER on inconsistent counts instead of inventing arrival',()=>{
    const value=fixture(['ARRIVAL']);value.selectedDateUnassigned!.count=2;
    const result=hotelUnassignedClassificationPresentation(value,date);
    expect(result.available).toBe(false);expect(result.groups.ARRIVAL).toHaveLength(0);expect(result.groups.OTHER).toHaveLength(1);
  });
  it('preserves native drag payload and drop command after moving arrival above board',async()=>{
    const onDropStay=vi.fn();render(<HotelRoomBoard {...props(fixture(['ARRIVAL']))} onDropStay={onDropStay}/>);
    const data=new Map<string,string>();const transfer={setData:vi.fn((k,v)=>data.set(k,v)),getData:vi.fn(k=>data.get(k)||''),setDragImage:vi.fn(),effectAllowed:'',dropEffect:''};
    await act(async () => { fireEvent.dragStart(screen.getByTestId('hotel-room-board-stay-예약-0'),{dataTransfer:transfer}); });
    expect(transfer.setData).toHaveBeenCalledWith('application/x-hotel-stay-id','예약-0');
    fireEvent.drop(screen.getByTestId('hotel-room-board-room-room'),{dataTransfer:transfer});
    expect(onDropStay).toHaveBeenCalledWith('예약-0','room',false);
  });
});
