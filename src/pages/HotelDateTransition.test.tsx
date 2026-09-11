// @vitest-environment jsdom
import {useEffect} from 'react';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {HotelDateTransition} from './HotelDateTransition';
afterEach(cleanup);
describe('011 stable presentation',()=>{
 it.each([['TODAY','PAST'],['PAST','PAST-2'],['PAST','TODAY'],['TODAY','FUTURE']])('retains the mounted %s view until %s is ready and blocks stale commands', (oldDate,newDate)=>{
  const mount=vi.fn(),command=vi.fn();
  function Board({date}:{date:string}) {useEffect(()=>{mount();},[]);return <button onClick={command}>{date} room</button>;}
  const view=(date:string,ready:boolean)=><HotelDateTransition date={date} ready={ready} onRetry={vi.fn()}><Board date={date}/></HotelDateTransition>;
  const {rerender}=render(view(oldDate,true));
  const node=screen.getByText(`${oldDate} room`);
  rerender(view(newDate,false));
  expect(screen.getByText(`${oldDate} room`)).toBe(node);expect(mount).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent(`${oldDate} 화면 유지`);
  expect(screen.getByTestId('hotel-date-presentation')).toHaveAttribute('inert');
  fireEvent.click(node);expect(command).not.toHaveBeenCalled();
  rerender(view(newDate,true));expect(screen.getByText(`${newDate} room`)).toBe(node);
  fireEvent.click(node);expect(command).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('hotel-date-presentation')).not.toHaveAttribute('inert');
  expect(screen.getByTestId('hotel-date-presentation')).toHaveClass('motion-reduce:transition-none');
 });
 it('keeps the last valid presentation on error, exposes retry, and never labels it as the failed date',()=>{
  const retry=vi.fn();const {rerender}=render(<HotelDateTransition date="A" ready onRetry={retry}><p>original board</p></HotelDateTransition>);
  rerender(<HotelDateTransition date="B" ready={false} error="조회 실패" onRetry={retry}><p>empty new board</p></HotelDateTransition>);
  expect(screen.getByText('original board')).toBeVisible();expect(screen.queryByText('empty new board')).toBeNull();
  expect(screen.getByTestId('hotel-date-presentation')).toHaveAttribute('data-displayed-date','A');
  expect(screen.getByRole('alert')).toHaveTextContent('조회 실패');fireEvent.click(screen.getByText('다시 시도'));expect(retry).toHaveBeenCalledOnce();
 });
 it('does not flash intermediate candidates during rapid selection',()=>{
  const view=(date:string,ready:boolean)=><HotelDateTransition date={date} ready={ready} onRetry={vi.fn()}><p>{date} rooms</p></HotelDateTransition>;
  const {rerender}=render(view('A',true));rerender(view('B',false));rerender(view('C',false));
  expect(screen.getByText('A rooms')).toBeVisible();expect(screen.queryByText('B rooms')).toBeNull();
  rerender(view('C',true));expect(screen.getByText('C rooms')).toBeVisible();expect(screen.queryByText('A rooms')).toBeNull();
 });
});
