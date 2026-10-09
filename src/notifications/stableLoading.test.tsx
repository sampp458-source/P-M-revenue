// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NotificationSession } from './NotificationProvider';
import { NotificationBell } from './NotificationUi';
import { emptyInbox, type Inbox, type NotificationRepository, type Notice } from './notificationRepository';
import { TaskRequestsPage, TaskWorkspace } from '../taskRequests/TaskRequestsPage';
import type { TaskRepository, TaskRequest } from '../taskRequests/taskRequestRepository';
vi.mock('../lib/supabase', () => ({ supabase: {} }));
const access = vi.hoisted(() => ({ enabled:true, can_create:false, owner:false, loading:false }));
vi.mock('../taskRequests/useTaskAccess', () => ({ useTaskAccess: () => access }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user:{id:'self'} }) }));
afterEach(() => { cleanup(); access.loading=false; vi.useRealTimers(); });
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; }
const notice = {id:'n',title:'알림 유지',message:'본문',created_at:'2026-10-07T00:00:00Z',priority:'NORMAL',ack_required:false} as Notice;
const inbox = {...emptyInbox,items:[notice]};
function notifications(fetch:()=>Promise<Inbox>, subscribe=vi.fn(()=>()=>{})) {
 const repository={inbox:vi.fn(fetch),subscribe} as unknown as NotificationRepository;
 render(<MemoryRouter><NotificationSession userId="self" repository={repository}><NotificationBell/></NotificationSession></MemoryRouter>);
 return repository;
}
const open=()=>fireEvent.click(screen.getByRole('button',{name:/알림센터, 읽지 않은/}));
it('first open has bounded center shell, no false empty; cached reopen keeps the same rows without a second page fetch',async()=>{
 const first=deferred<Inbox>(); const repo=notifications(()=>first.promise);
 open(); expect(document.querySelector('.pn-center-stable')).toBeTruthy(); expect(screen.queryByText('새로운 공지가 여기에 표시됩니다.')).toBeNull();
 await act(async()=>first.resolve(inbox));
 const row=screen.getByRole('button',{name:/알림 유지/}); const refresh=deferred<Inbox>();vi.mocked(repo.inbox).mockReturnValue(refresh.promise);
 fireEvent.click(screen.getByRole('button',{name:'닫기'}));open();
 expect(screen.getByRole('button',{name:/알림 유지/})).toBeTruthy();
 expect(repo.inbox).toHaveBeenCalledTimes(6); // three session refreshes plus separate authoritative unread pages
 await act(async()=>refresh.resolve(inbox));expect(row.textContent).toContain('알림 유지');
});
it.each(['focus','visibilitychange','revision'])('notification %s refresh preserves list DOM until authoritative response',async kind=>{
 vi.useFakeTimers();let revision=()=>{};
 const repo=notifications(async()=>inbox,vi.fn((_id,cb)=>{revision=cb;return()=>{};}) as never);
 await act(async()=>{});open();await act(async()=>{});
 const row=screen.getByRole('button',{name:/알림 유지/});const pending=deferred<Inbox>();vi.mocked(repo.inbox).mockReturnValue(pending.promise);
 if(kind==='revision')revision();else fireEvent(kind==='focus'?window:document,new Event(kind));
 await act(async()=>vi.advanceTimersByTimeAsync(180));
 expect(screen.getByRole('button',{name:/알림 유지/})).toBe(row);
 await act(async()=>pending.resolve({...emptyInbox}));expect(screen.queryByRole('button',{name:/알림 유지/})).toBeNull();expect(screen.getByText('새로운 알림이 없습니다.')).toBeTruthy();
});
it('filtered inbox keeps its own rows during revision; switching filter never borrows another query',async()=>{
 const repo=notifications(async()=>inbox);await act(async()=>{});open();await act(async()=>{});
 fireEvent.click(screen.getByRole('button',{name:'전체 기록'}));await act(async()=>{});
 const pending=deferred<Inbox>();vi.mocked(repo.inbox).mockReturnValue(pending.promise);
 fireEvent.click(screen.getByRole('button',{name:'읽지 않음 0'}));expect(screen.getByRole('button',{name:/알림 유지/})).toBeTruthy(); // its own previously fetched unread cache
 await act(async()=>pending.resolve(inbox));const row=screen.getByRole('button',{name:/알림 유지/});
 const next=deferred<Inbox>();vi.mocked(repo.inbox).mockReturnValue(next.promise);
 fireEvent.click(screen.getByRole('button',{name:/알림센터, 읽지 않은/}));expect(screen.getByRole('button',{name:/알림 유지/})).toBe(row);
 await act(async()=>next.resolve(inbox));expect(screen.getByRole('button',{name:/알림 유지/})).toBe(row);
});
const task={id:'t',title:'목록 유지',requester_name:'요청자',due_at:'2027-10-07T12:00:00Z',targets:[{recipient_id:'self',name:'담당자',completed_at:null}],cancelled_at:null} as TaskRequest;
function workspace(repo:TaskRepository,revision=0){return <MemoryRouter><TaskWorkspace userId="self" access={access} repository={repo} revision={revision}/></MemoryRouter>;}
it('access first load retains a bounded page header without exposing create permission',()=>{
 access.loading=true;render(<MemoryRouter><TaskRequestsPage/></MemoryRouter>);
 expect(screen.getByRole('heading',{name:'요청'})).toBeTruthy();expect(document.querySelector('.pt-workspace-region')).toBeTruthy();expect(screen.queryByRole('button',{name:'+ 요청'})).toBeNull();
});
it.each(['revision','focus','visibilitychange'])('task %s retains rows and shell while refreshing',async kind=>{
 const repo={list:vi.fn(async()=>[task])} as unknown as TaskRepository;
 const view=render(workspace(repo));await act(async()=>{});
 const row=screen.getByRole('button',{name:/목록 유지/});const shell=document.querySelector('.pt-task-page');
 const pending=deferred<TaskRequest[]>();vi.mocked(repo.list).mockReturnValue(pending.promise);
 if(kind==='revision')view.rerender(workspace(repo,1));else fireEvent(kind==='focus'?window:document,new Event(kind));
 expect(screen.getByRole('button',{name:/목록 유지/})).toBe(row);expect(document.querySelector('.pt-task-page')).toBe(shell);expect(screen.getByText('업데이트 중')).toBeTruthy();
 await act(async()=>pending.resolve([task]));expect(screen.getByRole('button',{name:/목록 유지/})).toBe(row);
});
it('task scope switch hides previous scope rows until new data arrives; empty is only shown after success',async()=>{
 const repo={list:vi.fn(async()=>[task])} as unknown as TaskRepository;render(workspace(repo));await act(async()=>{});
 const pending=deferred<TaskRequest[]>();vi.mocked(repo.list).mockReturnValue(pending.promise);
 fireEvent.click(screen.getByRole('button',{name:'보낸 요청'}));expect(screen.queryByRole('button',{name:/목록 유지/})).toBeNull();expect(screen.queryByText('보낸 요청이 없습니다.')).toBeNull();
 await act(async()=>pending.resolve([]));expect(screen.getByText('보낸 요청이 없습니다.')).toBeTruthy();
});
it('access resolution preserves the same page shell and does not fetch before permission arrives',async()=>{
 const repo={list:vi.fn(async()=>[task])} as unknown as TaskRepository;
 const root=(loading:boolean)=><MemoryRouter><TaskWorkspace userId="self" access={access} accessLoading={loading} revision={0} repository={repo}/></MemoryRouter>;
 const view=render(root(true));const shell=document.querySelector('.pt-task-page');expect(repo.list).not.toHaveBeenCalled();
 view.rerender(root(false));await act(async()=>{});expect(document.querySelector('.pt-task-page')).toBe(shell);expect(repo.list).toHaveBeenCalledTimes(1);
});
it('detail refetch retains the mounted detail and a stale list response cannot replace another scope',async()=>{
 const repo={list:vi.fn(async()=>[task]),detail:vi.fn(async()=>task)} as unknown as TaskRepository;
 const view=render(workspace(repo));await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:/목록 유지/}));await act(async()=>{});
 const detail=document.querySelector('.pt-task-detail');const pending=deferred<TaskRequest>();vi.mocked(repo.detail).mockReturnValue(pending.promise);
 view.rerender(workspace(repo,1));expect(document.querySelector('.pt-task-detail')).toBe(detail);
 await act(async()=>pending.resolve(task));expect(document.querySelector('.pt-task-detail')).toBe(detail);
 fireEvent.click(screen.getByRole('button',{name:'목록으로'}));await act(async()=>{});
 const old=deferred<TaskRequest[]>(),latest=deferred<TaskRequest[]>();vi.mocked(repo.list).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
 fireEvent.click(screen.getByRole('button',{name:'보낸 요청'}));fireEvent.click(screen.getByRole('button',{name:'받은 요청'}));
 await act(async()=>latest.resolve([task]));await act(async()=>old.resolve([]));expect(screen.getByRole('button',{name:/목록 유지/})).toBeTruthy();
});
