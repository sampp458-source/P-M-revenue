import {usePaymentAccess} from '../paymentRequests/usePaymentAccess';
import {RequestHubWorkspace} from '../paymentRequests/RequestHubWorkspace';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/notificationContext';
import { Modal } from '../components/ui';
import { useTaskAccess } from './useTaskAccess';
import { TaskComposer, TaskDetail } from './TaskRequestUi';
import { taskRequestRepository, type TaskRepository, type TaskRequest, type TaskAccess } from './taskRequestRepository';
import { taskTime, taskSummary, taskStatus } from './taskRequestPresentation';
import './taskRequests.css';
import {canLaunchRequest} from './RequestLauncher';

export function TaskRequestsPage() {
 const { user } = useAuth();
 const notifications = useNotifications();
 const access = useTaskAccess(user?.id, notifications?.inbox);
 const payment=usePaymentAccess(user?.id,notifications?.inbox);
 if(user && (payment.confirmation_enabled||payment.payment_enabled))return <RequestHubWorkspace key={user.id} userId={user.id} taskAccess={access} paymentAccess={payment} revision={notifications?.inbox}/>;
 if (!user || (!access.loading && !payment.loading && !access.enabled)) return <section className="pt-task-page"><h1>요청</h1><p>업무요청에 접근할 수 없습니다.</p></section>;
 return <TaskWorkspace key={user.id} userId={user.id} access={access} accessLoading={access.loading||payment.loading} revision={notifications?.inbox} />;
}

export function TaskWorkspace({ userId, access, accessLoading = false, revision, repository = taskRequestRepository }: { userId: string; access: TaskAccess; accessLoading?: boolean; revision: unknown; repository?: TaskRepository }) {
 const [params, setParams] = useSearchParams();
 const requestedScope = params.get('scope');
 const scope = requestedScope === 'sent' ? 'sent' : requestedScope === 'all' && access.owner ? 'all' : 'inbox';
 const filter = ['done', 'all'].includes(params.get('filter') || '') ? params.get('filter')! : 'active';
 const rawOffset = Number(params.get('offset') || 0);
 const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
 const id = params.get('task') || undefined;
 const [items, setItems] = useState<TaskRequest[]>([]), [detail, setDetail] = useState<TaskRequest | null>(null);
 const [compose, setCompose] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true);
 const generation = useRef(0);
 const queryKey = `${userId}:${id || `${scope}:${offset}:${filter}`}`;
 const [loadedKey, setLoadedKey] = useState<string | null>(null);
 const initialLoading = accessLoading || loadedKey !== queryKey;
 const update = (values: Record<string, string | undefined>) => {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(values)) { if (value === undefined) next.delete(key); else next.set(key, value); }
  setParams(next);
 };
 const load = useCallback(async () => {
  if (accessLoading) return;
  const token = ++generation.current;
  setLoading(true);
  try {
   if (id) { const next = await repository.detail(id); if (token === generation.current) setDetail(next); }
   else { const next = await repository.list(scope, offset, filter); if (token === generation.current) setItems(next); }
   if (token === generation.current) { setError(''); setLoadedKey(queryKey); }
  } catch (e) { if (token === generation.current) { setError((e as Error).message); setDetail(null); setItems([]); setLoadedKey(queryKey); } }
  finally { if (token === generation.current) setLoading(false); }
 }, [id, repository, scope, offset, filter, queryKey, accessLoading]);
 useEffect(() => {
  const requests = generation;
  const refresh = () => { if (document.visibilityState !== 'hidden') void load(); };
  refresh(); const timer = setInterval(refresh, 30000);
  window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
  return () => { requests.current++; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
 }, [load, revision]);
 const shown = items.filter(t => {
  const targets = scope === 'inbox' ? t.targets.filter(v => v.recipient_id === userId) : t.targets;
  const complete = targets.every(v => v.completed_at);
  return filter === 'all' || (filter === 'done' ? complete : !complete && !t.cancelled_at);
 });
 return <section className="pt-task pt-task-page" aria-busy={loading}>
  <header className="pt-page-header"><div><h1>요청</h1><p className="pt-secondary">받은 요청과 처리 현황을 관리합니다.</p></div>{!accessLoading && canLaunchRequest(access) && <button className="pn-primary" onClick={() => setCompose(true)}>+ 요청</button>}</header>
  {error && <p role="alert">{error}<button onClick={() => void load()}>다시 불러오기</button></p>}
  <div className="pt-workspace-region">
  {loading && !initialLoading && <span className="pt-refreshing" role="status">업데이트 중</span>}
  {id ? <><button className="pt-back" onClick={() => update({ task: undefined })}>목록으로</button>{initialLoading ? <p role="status">업무를 불러오는 중입니다.</p> : detail && <TaskDetail key={detail.id} task={detail} userId={userId} repository={repository} onRefresh={load} />}</> : <>
   <nav className="pt-page-tabs" aria-label="요청 목록">{([['inbox', '받은 요청'], ['sent', '보낸 요청'], ...(access.owner ? [['all', '전체 현황']] : [])]).map(([value, label]) => <button key={value} aria-pressed={scope === value} onClick={() => update({ scope: value, offset: undefined })}>{label}</button>)}</nav>
   <label className="pt-filter">상태<select value={filter} onChange={e => update({ filter: e.target.value, offset: undefined })}><option value="active">진행중</option><option value="done">완료</option><option value="all">전체</option></select></label>
   <div className="pt-list-region">{initialLoading ? <p role="status">업무를 불러오는 중입니다.</p> : <div className="pt-task-list">{shown.map(t => { const sum = taskSummary(t); return <button className="pt-task-row" key={t.id} onClick={() => update({ task: t.id })}><strong>{t.title}</strong>{scope === 'inbox' && t.targets.find(v => v.recipient_id === userId) && <span>{taskStatus(t, t.targets.find(v => v.recipient_id === userId)!)}</span>}<span>{t.requester_name} · 완료기한 {taskTime(t.due_at)}</span><span>담당 {sum.total} · 확인 {sum.ack} · 완료 {sum.complete} · 지연 {sum.overdue}</span></button>; })}{!shown.length && !error && <p className="pt-empty">{scope === 'inbox' ? '받은 요청이 없습니다.' : scope === 'sent' ? '보낸 요청이 없습니다.' : '등록된 요청이 없습니다.'}</p>}</div>}</div>
   <div className="pt-pagination"><button disabled={!offset || loading} onClick={() => update({ offset: String(Math.max(0, offset - 50)) })}>이전</button><button disabled={items.length < 50 || loading} onClick={() => update({ offset: String(offset + 50) })}>다음</button></div>
  </>}
  </div>
  <Modal open={!accessLoading && compose && canLaunchRequest(access)} title="업무요청 작성" onClose={() => setCompose(false)} size="medium"><TaskComposer userId={userId} repository={repository} onCreated={value => { setCompose(false); update({ task: value }); }} /></Modal>
 </section>;
}
