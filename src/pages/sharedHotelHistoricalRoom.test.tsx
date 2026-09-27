import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SchedulePeople } from './operationSchedulePresentation';
import { operationScheduleDisplayTitle, operationScheduleHotelRoomLabel, type OperationSchedule } from './operationsScheduleRepository';
const fixture = (patch: Partial<OperationSchedule>) => ({ status: 'completed', hotelEventKind: 'check_out', hotelRoomResolutionStatus: 'unavailable', dogs: [{ id: 'dog', name: '합성 Shared A', customerId: null }], assignees: [{ id: 'staff', name: '담당자' }], ...patch } as OperationSchedule);
describe('completed Hotel historical room presentation', () => {
  for (const hotelEventKind of ['check_in', 'check_out'] as const) {
    it(`${hotelEventKind}: resolves historical room without operational attention`, () => {
      const row = fixture({ hotelEventKind, hotelRoomResolutionStatus: 'resolved', hotelRoomName: 'DELUXE 2' });
      expect(operationScheduleDisplayTitle(row)).toContain('DELUXE 2');
      expect(renderToStaticMarkup(<SchedulePeople schedule={row} />)).toContain('data-room-attention="false"');
    });
    it(`${hotelEventKind}: separates unproven history from actionable room problems`, () => {
      const row = fixture({ hotelEventKind });
      expect(operationScheduleHotelRoomLabel(row)).toBe('객실 이력 미확인');
      expect(renderToStaticMarkup(<SchedulePeople schedule={row} />)).toContain('data-room-attention="false"');
      const active = fixture({ hotelEventKind, status: 'scheduled' });
      expect(operationScheduleHotelRoomLabel(active)).toBe('객실 정보 확인 필요');
      expect(renderToStaticMarkup(<SchedulePeople schedule={active} />)).toContain('data-room-attention="true"');
    });
  }
  it('preserves unresolved upcoming assignment and independent assignee attention', () => {
    expect(operationScheduleHotelRoomLabel(fixture({ status: 'scheduled', hotelRoomResolutionStatus: 'unassigned', hotelRoomTypeName: 'DELUXE' }))).toBe('DELUXE · 미배정');
    expect(renderToStaticMarkup(<SchedulePeople schedule={fixture({ assignees: [] })} />)).toContain('data-unassigned="true"');
  });
});
