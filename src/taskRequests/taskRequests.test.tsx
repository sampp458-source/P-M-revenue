import {MemoryRouter} from 'react-router-dom';
import {TaskWorkspace} from './TaskRequestsPage';
import type {ComponentProps} from 'react';
// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {pendingTaskCreates} from './taskAttempts';
import {TaskComposer,TaskDetail} from './TaskRequestUi';
import {CapabilityManagement} from './CapabilityManagement';
import {taskDue,taskStatus} from './taskRequestPresentation';
import {taskRequestRepository,type TaskRequest} from './taskRequestRepository';
vi.mock('../lib/supabase',()=>({supabase:{rpc:vi.fn()}}));
afterEach(()=>{cleanup();pendingTaskCreates.clear();vi.restoreAllMocks();});
function TaskHub({initialId,...props}:ComponentProps<typeof TaskWorkspace>&{initialId?:string;onClose:()=>void}) { return <MemoryRouter initialEntries={['/operations/requests'+(initialId?'?task='+initialId:'')]}><TaskWorkspace {...props}/></MemoryRouter>; }
const t:TaskRequest={id:'task1',requester_id:'owner',requester_name:'요청자',title:'호텔 창고 정리',body:'선반을 정리해주세요.',due_at:'2099-10-05T08:00:00Z',created_at:'2026-10-05T00:00:00Z',cancelled_at:null,cancel_reason:null,version:1,can_cancel:false,targets:[{recipient_id:'staff',name:'담당자',acknowledged_at:null,completed_at:null,completion_note:null,version:1}]};
const repo=()=>({...taskRequestRepository,recipients:vi.fn(async()=>[{id:'staff',name:'담당자'}]),create:vi.fn<typeof taskRequestRepository.create>(async()=>t.id),ack:vi.fn(async()=>{}),complete:vi.fn(async()=>{}),cancel:vi.fn(async()=>{}),detail:vi.fn(async()=>t),list:vi.fn(async()=>[t]),directory:vi.fn(async()=>[{id:'staff',name:'담당자',active:true,operation_role:'staff',operation_active:true,capabilities:{TASK_REQUEST_CREATE:{active:false,version:0}}}]),setCapability:vi.fn(async()=>{})});
describe('Task Request candidate',()=>{
 it('KST date boundary and mandatory actual time',()=>{expect(taskDue('2099-10-05T00:30',0)).toBe('2099-10-04T15:30:00.000Z');expect(()=>taskDue('2099-10-05')).toThrow();expect(()=>taskDue('2020-10-05T12:00')).toThrow();});
 it('derived priority and inclusive on-time completion',()=>{const target=t.targets[0];expect(taskStatus(t,target,0)).toBe('미확인');expect(taskStatus(t,target,Date.parse(t.due_at)+1)).toBe('지연 · 미확인');expect(taskStatus(t,{...target,acknowledged_at:t.created_at},0)).toBe('확인');expect(taskStatus(t,{...target,completed_at:t.due_at},0)).toBe('완료');expect(taskStatus({...t,cancelled_at:t.created_at},target,0)).toBe('취소');});
 it('composer exposes no announcement expiry or ACK toggle',async()=>{const r=repo();render(<TaskComposer repository={r} onCreated={()=>{}}/>);await screen.findByText('담당자',{selector:'.pt-check'});expect(screen.queryByText(/게시 종료/)).toBeNull();expect(screen.queryByText('ACK 필요')).toBeNull();expect((screen.getByLabelText('완료기한') as HTMLInputElement).value).toBe('');});
 it('create payload contains task fields only and excludes hidden announcement fields',async()=>{const r=repo();render(<TaskComposer repository={r} onCreated={()=>{}}/>);fireEvent.click(await screen.findByRole('checkbox'));fireEvent.change(screen.getByLabelText('제목'),{target:{value:'업무'}});fireEvent.change(screen.getByLabelText('내용'),{target:{value:'내용'}});fireEvent.change(screen.getByLabelText('완료기한'),{target:{value:'2099-10-05T17:00'}});fireEvent.submit(screen.getByRole('button',{name:'업무요청 보내기'}).closest('form')!);await waitFor(()=>expect(r.create).toHaveBeenCalledTimes(1));expect(Object.keys(r.create.mock.calls[0][0]).sort()).toEqual(['body','dueAt','recipientIds','requestId','title']);});
 it('opening detail does not ACK, explicit action does',async()=>{const r=repo();render(<TaskDetail task={t} userId="staff" repository={r} onRefresh={async()=>{}}/>);expect(r.ack).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'확인했습니다'}));await waitFor(()=>expect(r.ack).toHaveBeenCalledTimes(1));expect(r.complete).not.toHaveBeenCalled();});
 it('ACK exposes completion with optional memo and double tap locks',async()=>{const r=repo();r.complete=vi.fn(()=>new Promise<void>(()=>{}));render(<TaskDetail task={{...t,targets:[{...t.targets[0],acknowledged_at:t.created_at}]}} userId="staff" repository={r} onRefresh={async()=>{}}/>);const b=screen.getByRole('button',{name:'완료했습니다'});fireEvent.click(b);fireEvent.click(b);expect(r.complete).toHaveBeenCalledTimes(1);});
 it('completed target is immutable and history visible',()=>{render(<TaskDetail task={{...t,targets:[{...t.targets[0],acknowledged_at:t.created_at,completed_at:t.created_at,completion_note:'완료 메모'}]}} userId="staff" onRefresh={async()=>{}}/>);expect(screen.queryByRole('button',{name:'완료했습니다'})).toBeNull();expect(screen.getByText('완료 메모')).toBeTruthy();});
 it('revoked creator retains sent list entry but not composer',async()=>{const r=repo();render(<TaskHub userId="staff" access={{enabled:true,can_create:false,owner:false}} revision={0} repository={r} onClose={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'보낸 요청'}));await waitFor(()=>expect(r.list).toHaveBeenCalledWith('sent',0,'active'));expect(screen.queryByRole('button',{name:'업무요청 작성'})).toBeNull();});
 it('owner directory toggles independent capabilities',async()=>{const r=repo();render(<CapabilityManagement repository={r}/>);fireEvent.click(await screen.findByLabelText('업무요청 발행'));await waitFor(()=>expect(r.setCapability).toHaveBeenCalledWith('staff','TASK_REQUEST_CREATE',true,0,expect.any(String)));});
 it('directory failure provides no writable controls',async()=>{const r=repo();r.directory=vi.fn(async()=>{throw new Error('접근 권한 없음');});render(<CapabilityManagement repository={r}/>);await screen.findByRole('alert');expect(screen.queryByRole('checkbox')).toBeNull();});
 it('revision refetch updates task detail',async()=>{const r=repo();const v=render(<TaskHub userId="staff" access={{enabled:true,can_create:false,owner:false}} initialId="task1" revision={0} repository={r} onClose={()=>{}}/>);await screen.findByText(t.title);const before=r.detail.mock.calls.length;v.rerender(<TaskHub userId="staff" access={{enabled:true,can_create:false,owner:false}} initialId="task1" revision={1} repository={r} onClose={()=>{}}/>);await waitFor(()=>expect(r.detail.mock.calls.length).toBeGreaterThan(before));});
});

it('ambiguous create retains same request across close/reopen without hidden field leakage',async()=>{
 const r=repo();r.create.mockRejectedValueOnce(new Error('응답 확인 필요'));
 const v=render(<TaskComposer userId="account-a" repository={r} onCreated={()=>{}}/>);
 fireEvent.click(await screen.findByRole('checkbox'));fireEvent.change(screen.getByLabelText('제목'),{target:{value:'업무'}});fireEvent.change(screen.getByLabelText('내용'),{target:{value:'내용'}});fireEvent.change(screen.getByLabelText('완료기한'),{target:{value:'2099-10-05T17:00'}});fireEvent.submit(screen.getByRole('button',{name:'업무요청 보내기'}).closest('form')!);
 await screen.findByRole('alert');const first=r.create.mock.calls[0][0];v.unmount();render(<TaskComposer userId="account-a" repository={r} onCreated={()=>{}}/>);
 fireEvent.submit(screen.getByRole('button',{name:'같은 요청으로 결과 확인'}).closest('form')!);await waitFor(()=>expect(r.create).toHaveBeenCalledTimes(2));expect(r.create.mock.calls[1][0]).toEqual(first);
});
it('inflight detail response cannot reopen stale detail after returning to list',async()=>{
 const r=repo();let resolve!:(value:TaskRequest)=>void;r.detail=vi.fn(()=>new Promise<TaskRequest>(r=>{resolve=r;}));render(<TaskHub userId="staff" access={{enabled:true,can_create:false,owner:false}} initialId="task1" revision={0} repository={r} onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'목록으로'}));resolve(t);await screen.findByRole('button',{name:'보낸 요청'});expect(screen.queryByRole('button',{name:'확인했습니다'})).toBeNull();
});
it('ambiguous permission retry preserves request id and expected version',async()=>{
 const r=repo();r.setCapability.mockRejectedValueOnce(new Error('응답 확인 필요'));render(<CapabilityManagement repository={r}/>);fireEvent.click(await screen.findByLabelText('업무요청 발행'));await screen.findByRole('alert');const args=r.setCapability.mock.calls[0];fireEvent.click(screen.getByRole('button',{name:'같은 요청으로 결과 확인'}));await waitFor(()=>expect(r.setCapability).toHaveBeenCalledTimes(2));expect(r.setCapability.mock.calls[1]).toEqual(args);
});
