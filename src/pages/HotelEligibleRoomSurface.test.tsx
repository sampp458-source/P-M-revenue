// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {HotelEligibleRoomSurface} from './HotelEligibleRoomSurface';
afterEach(cleanup);
it('only enables current server-eligible rooms, and never selects a recommendation automatically',()=>{
 const onSelect=vi.fn();
 const rooms=[{roomId:'a',roomName:'DELUXE A',eligible:true,recommended:true},{roomId:'b',roomName:'DELUXE B',eligible:false}];
 const props={rooms,selectedId:'',disabled:false,onSelect,children:null};
 const {rerender}=render(<HotelEligibleRoomSurface {...props}/>);
 expect(onSelect).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText(/배정 불가 1실 확인/));
 expect(screen.getByRole('button',{name:/DELUXE B/})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:/DELUXE A/}));expect(onSelect).toHaveBeenCalledWith('a');
 rerender(<HotelEligibleRoomSurface {...props} selectedId="a"/>);
 expect(screen.getByRole('button',{name:/DELUXE A/})).toHaveAttribute('aria-pressed','true');
 rerender(<HotelEligibleRoomSurface {...props} rooms={[]} disabled/>);
 expect(screen.queryByRole('button')).not.toBeInTheDocument();
 expect(screen.getByText(/실제 시각에 맞는 객실/)).toBeVisible();
});
