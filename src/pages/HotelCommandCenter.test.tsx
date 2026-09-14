// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {useEffect} from 'react';
import {render,screen,fireEvent,within,cleanup} from '@testing-library/react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {HotelOperationsWorkspace} from './HotelOperationsWorkspace';
import {HotelDayOperationsTimeline,type HotelTimelineItem} from './HotelDayOperationsTimeline';
import {HotelAttentionQueue} from './HotelAttentionQueue';
afterEach(cleanup);
describe('hotel command center presentation',()=>{
 it('keeps room and secondary module identity while navigating the workspace',()=>{
  const mount=vi.fn();function Module(){useEffect(()=>{mount();},[]);return <button>기존 업무</button>;}
  const {container}=render(<HotelOperationsWorkspace rooms={<Module/>} modules={<Module/>} schedule={<p>일정 내용</p>} attention={<p>확인 내용</p>} attentionCount={2}/>);
  const room=container.querySelector('[data-workspace-pane="rooms"]');
  fireEvent.click(screen.getByRole('button',{name:'일정'}));
  expect(container.firstChild).toHaveAttribute('data-view','schedule');
  fireEvent.click(screen.getByRole('button',{name:'처리 필요 2'}));
  fireEvent.click(screen.getByRole('button',{name:'객실'}));
  expect(container.querySelector('[data-workspace-pane="rooms"]')).toBe(room);expect(mount).toHaveBeenCalledTimes(2);
 });
 it('renders no zero queue and routes nonzero items only to existing detail action',()=>{
  const open=vi.fn();const {rerender,container}=render(<HotelAttentionQueue items={[]}/>);expect(container).toBeEmptyDOMElement();
  rerender(<HotelAttentionQueue disabled items={[{id:'a',name:'테스트견',reason:'입실 기록 확인',onOpen:open}]}/>);
  fireEvent.click(screen.getByRole('button'));expect(open).not.toHaveBeenCalled();
  rerender(<HotelAttentionQueue items={[{id:'a',name:'테스트견',reason:'입실 기록 확인',onOpen:open}]}/>);
  fireEvent.click(screen.getByRole('button'));expect(open).toHaveBeenCalledTimes(1);
 });
 it('groups equal planned times in Seoul without inventing actual status or losing items',()=>{
  const open=vi.fn();const items:HotelTimelineItem[]=[{id:'a',at:'2026-09-13T06:00:00Z',name:'가',detail:'입실 · 객실 미정',kind:'check_in',onOpen:open},{id:'b',at:'2026-09-13T06:00:00Z',name:'나',detail:'퇴실 · 객실 정보 확인 필요',kind:'check_out',onOpen:open},{id:'c',at:'2026-09-13T14:00:00Z',name:'다',detail:'일반 일정',kind:'other',onOpen:open}];
  const {container}=render(<HotelDayOperationsTimeline items={items}/>);
  expect(container.querySelectorAll('.hotel-time-group')).toHaveLength(2);
  expect(within(container.querySelector('.hotel-time-group') as HTMLElement).getAllByRole('button')).toHaveLength(2);
  expect(screen.getByText('15:00')).toBeInTheDocument();expect(screen.getByText('23:00')).toBeInTheDocument();
  expect(screen.getByText(/예정 일정 기준/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:/가 입실/}));expect(open).toHaveBeenCalledTimes(1);
 });
 it('preserves unspecified time without turning it into midnight and handles empty date',()=>{
  const {rerender}=render(<HotelDayOperationsTimeline items={[{id:'a',at:'2026-09-12T15:00:00Z',timeUnspecified:true,name:'가',detail:'입실 예정',kind:'check_in',onOpen:()=>{}}]}/>);
  expect(screen.getByText('시간 미정')).toBeInTheDocument();expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  rerender(<HotelDayOperationsTimeline items={[]}/>);expect(screen.getByText('선택한 날짜에 표시할 일정이 없습니다.')).toBeInTheDocument();
 });
});
