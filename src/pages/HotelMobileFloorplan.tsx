import type { ReactNode } from 'react';
import './hotel-mobile-floorplan.css';

type RoomIdentity = { id: string; roomTypeCode: string };
// Transpose the desktop's two type rows without sorting, reversing or inventing rooms.
export function hotelFloorplanRows<T extends RoomIdentity>(rooms: readonly T[]) {
  const left = rooms.filter(room => room.roomTypeCode === 'STANDARD');
  const right = rooms.filter(room => room.roomTypeCode === 'DELUXE');
  return Array.from({length: Math.max(left.length, right.length)}, (_, index) => ({left: left[index], right: right[index]}));
}

export function HotelMobileFloorplan<T extends RoomIdentity>({rooms, renderRoom}: {rooms: readonly T[]; renderRoom: (room: T) => ReactNode}) {
  return <section className="hotel-mobile-floorplan" aria-label="호텔 객실 배치도" data-testid="hotel-room-board-mobile-projection">
    <div className="hotel-floorplan-row hotel-floorplan-head"><strong>STANDARD</strong><strong>DELUXE</strong></div>
    {hotelFloorplanRows(rooms).map((row, index) => <div className="hotel-floorplan-row" key={row.left?.id ?? row.right!.id}>
      {(['left', 'right'] as const).map(side => <div key={side} className="hotel-floorplan-slot" data-side={side} data-position={index} data-room-id={row[side]?.id} aria-hidden={!row[side] || undefined}>{row[side] ? renderRoom(row[side]) : null}</div>)}
      <div className="hotel-floorplan-aisle" aria-hidden="true"/>
    </div>)}
  </section>;
}
