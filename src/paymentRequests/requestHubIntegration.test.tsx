// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {RequestHubWorkspace} from './RequestHubWorkspace';
import {RequestTypeComposer} from './RequestTypeComposer';
import {emptyPaymentAccess} from './paymentRequestTypes';
const s=vi.hoisted(()=>({list:vi.fn(),detail:vi.fn(),command:vi.fn(),handlers:vi.fn()}));
vi.mock('./paymentRequestRepository',async original=>({...await original<typeof import('./paymentRequestRepository')>(),paymentRequestRepository:s}));
vi.mock('../lib/supabase',()=>({supabase:{rpc:vi.fn()}}));
vi.mock('../taskRequests/TaskRequestUi',()=>({TaskComposer:()=> <p>기존 업무 composer</p>,TaskDetail:()=> <p>기존 업무 detail</p>}));
const access={...emptyPaymentAccess,confirmation_enabled:true,payment_enabled:true,confirmation_create:true,payment_create:true};
const row={request_type:'PAYMENT_CONFIRMATION_REQUEST',id:'c1',display_title:'새 입금자 · 입금 확인',status:'REQUESTED',lifecycle:'OPEN',created_at:'2026-10-07T00:00:00Z',due_at:null,counterparty:'검수 요청자'};
beforeEach(()=>{s.list.mockResolvedValue({count:1,items:[row]});s.handlers.mockResolvedValue([{id:'h',name:'검수 담당자'}]);s.command.mockResolvedValue({id:'new',version:1});s.detail.mockResolvedValue({id:'c1',request_type:row.request_type,payer_name:'새 입금자',reported_amount:100000,requester_name:'요청자',handler_name:'담당자',status:'REQUESTED',version:1,can_process:true,can_cancel:false});});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function hub(path='/operations/requests'){return render(<MemoryRouter initialEntries={[path]}><RequestHubWorkspace userId="self" taskAccess={{enabled:true,can_create:true,owner:false}} paymentAccess={access} revision={0}/></MemoryRouter>);}
it('mixed type facade rendered; scope/type filters use server pagination',async()=>{hub();await screen.findByText('새 입금자 · 입금 확인');expect(s.list).toHaveBeenCalledWith('inbox','ALL','active',0);fireEvent.change(screen.getByLabelText('유형'),{target:{value:'PAYMENT_REQUEST'}});await waitFor(()=>expect(s.list).toHaveBeenCalledWith('inbox','PAYMENT_REQUEST','active',0));fireEvent.click(screen.getByText('보낸 요청'));await waitFor(()=>expect(s.list).toHaveBeenCalledWith('sent','PAYMENT_REQUEST','active',0));expect(screen.queryByText('전체 현황')).toBeNull();});
it('same-query refresh retains rows until response; no composer duplicate on rapid clicks',async()=>{hub();await screen.findByText('새 입금자 · 입금 확인');let resolve!:(v:unknown)=>void;s.list.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));fireEvent(window,new Event('focus'));expect(screen.getByText('새 입금자 · 입금 확인')).toBeTruthy();await act(async()=>resolve({count:1,items:[row]}));fireEvent.click(screen.getByText('+ 요청'));fireEvent.click(screen.getByText('+ 요청'));expect(screen.getAllByRole('dialog')).toHaveLength(1);});
it('route scope change never renders stale rows from different query',async()=>{hub();await screen.findByText('새 입금자 · 입금 확인');s.list.mockImplementationOnce(()=>new Promise(()=>{}));fireEvent.click(screen.getByText('보낸 요청'));expect(screen.queryByText('새 입금자 · 입금 확인')).toBeNull();});
it('payment deep-link loads correct detail and does not resolve on read',async()=>{hub('/operations/requests?type=PAYMENT_CONFIRMATION_REQUEST&request=c1');await screen.findByText('새 입금자');expect(s.detail).toHaveBeenCalledWith('PAYMENT_CONFIRMATION_REQUEST','c1');expect(s.command).not.toHaveBeenCalled();});
it('one type opens composer directly; several offer only permitted choices',async()=>{const ui=render(<RequestTypeComposer types={['PAYMENT_REQUEST']} userId="launcher" onCreated={()=>{}}/>);await screen.findByText('검수 담당자');expect(screen.getByLabelText(' 지급 대상'.trim())).toBeTruthy();ui.rerender(<RequestTypeComposer types={['TASK_REQUEST','PAYMENT_CONFIRMATION_REQUEST']} userId="launcher" onCreated={()=>{}}/>);expect(screen.queryByText('지급 요청')).toBeNull();fireEvent.click(screen.getByText('결제 확인 요청'));await screen.findByLabelText('입금자명 / 확인 대상 이름');});

it('detail back restores mixed-list type and scope/pagination',async()=>{hub('/operations/requests?scope=sent&type=ALL&filter=all&offset=50');fireEvent.click(await screen.findByRole('button',{name:/새 입금자 · 입금 확인/}));await screen.findByRole('heading',{name:'새 입금자'});fireEvent.click(screen.getByText('목록으로'));await screen.findByText('새 입금자 · 입금 확인');expect(s.list).toHaveBeenLastCalledWith('sent','ALL','all',50);});

it('unavailable assigned handler is visible in the normalized list',async()=>{s.list.mockResolvedValueOnce({count:1,items:[{...row,handler_unavailable:true}]});hub();await screen.findByText('처리 담당자 사용 불가 · 관리 확인 필요');expect(screen.queryByRole('button',{name:'관리 종료'})).toBeNull();});
