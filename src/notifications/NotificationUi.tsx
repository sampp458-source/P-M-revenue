import { PushSettings } from "./PushSettings";
import { webPushEnabled } from "./webPushClient";
import { useEffect, useRef, useState } from "react";
import { Bell, Check, ChevronLeft, ChevronRight, Megaphone, Plus } from "lucide-react";
import { Modal, Toast } from "../components/ui";
import { useNotifications } from "./notificationContext";
import { NotificationFailure } from "./notificationRepository";
import type { Notice, Publication, PublishInput, Receipt, Target } from "./notificationRepository";
export function notificationTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? "방금 전" : minutes < 60 ? `${minutes}분 전` : minutes < 1440 ? `${Math.floor(minutes / 60)}시간 전` : notificationTime(value);
}
export function NotificationBell() {
  const state = useNotifications();
  if (!state) return null;
  return <button type="button" className="pn-notification-bell" aria-label={`알림센터, 읽지 않은 알림 ${state.inbox.unread_count}개`} onClick={() => { state.setView("center"); void state.refresh(); }}>
    <Bell size={19} aria-hidden="true" />
    {state.inbox.unread_count > 0 && <span className="pn-bell-count">{state.inbox.unread_count > 99 ? "99+" : state.inbox.unread_count}</span>}
  </button>;
}
function NoticeRow({ item, onOpen }: { item: Notice; onOpen: (item: Notice) => void }) {
  return <button type="button" className={`pn-notice-row ${item.read_at ? "pn-read" : "pn-unread"}`} onClick={() => onOpen(item)}>
    <span className={`pn-read-dot ${item.read_at ? "is-read" : ""}`} aria-label={item.read_at ? "읽음" : "읽지 않음"} />
    <span className="pn-notice-copy"><span className="pn-notice-meta">공지 · {relativeTime(item.created_at)}{item.priority === "IMPORTANT" && <span className="pn-important">중요</span>}</span>
      <strong>{item.title}</strong><span className="pn-preview">{item.message}</span>
      {item.ack_required && <span className={`pn-ack-state ${item.acknowledged_at ? "pn-acked" : "pn-needs-ack"}`}>{item.acknowledged_at ? "확인 완료" : "확인 필요"}</span>}
    </span><ChevronRight size={16} aria-hidden="true" />
  </button>;
}
type ComposeSeed = Omit<PublishInput, "requestId">;
export function NotificationDialogs() {
  const state = useNotifications();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [publishAttempt, setPublishAttempt] = useState<PublishInput | null>(null);
  const [seed, setSeed] = useState<ComposeSeed | null>(null);
  const [source, setSource] = useState<Publication | null>(null);
  const [retractOffer, setRetractOffer] = useState<Publication | null>(null);
  const [sentVersion, setSentVersion] = useState(0);
  const [unread, setUnread] = useState(false);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Notice[] | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const presented = useRef(new Set<string>());
  const repo = state?.repository;
  const view = state?.view;
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!view || view === "closed") return;
    const frame = requestAnimationFrame(() => contentRef.current?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled), select:not(:disabled)")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [view]);
  useEffect(() => { setError(""); }, [view]);
  useEffect(() => {
    if (!repo || view !== "center") return;
    let live = true;
    setPageLoading(true); setPage(null);
    void repo.inbox(offset, unread).then(r => { if (live) setPage(r.items); }).catch(() => { if (live) setError("목록을 불러오지 못했습니다. 다시 열어 주세요."); }).finally(() => { if (live) setPageLoading(false); });
    return () => { live = false; };
  }, [repo, view, offset, unread, state?.inbox]);
  const popup = state?.inbox.popup;
  useEffect(() => {
    if (view !== "summary" || !repo || !popup) return;
    const markVisible = () => {
      if (document.visibilityState === "hidden") return;
      const ids = popup.map(n => n.id).filter(id => !presented.current.has(id));
      if (!ids.length) return;
      ids.forEach(id => presented.current.add(id));
      void repo.presented(ids).catch(() => setError("공지 노출 기록을 저장하지 못했습니다. 다음 접속 시 다시 표시될 수 있습니다."));
    };
    markVisible(); document.addEventListener("visibilitychange", markVisible);
    return () => document.removeEventListener("visibilitychange", markVisible);
  }, [view, repo, popup]);
  const detailId = state?.detail?.id;
  const setDetail = state?.setDetail;
  useEffect(() => {
    if (view !== "detail" || !detailId || !repo || !setDetail) return;
    let live = true;
    void repo.detail(detailId).then(n => { if (live) { setDetail(n); if (!n) setError("회수되었거나 게시 기간이 끝난 공지입니다."); } }).catch(() => { if (live) { setDetail(null); setError("공지를 다시 불러오지 못했습니다."); } });
    return () => { live = false; };
  }, [view, detailId, repo, setDetail, state?.inbox]);
  if (!state) return null;
  async function act(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "요청을 완료하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  const open = (item: Notice) => { void act(async () => {
    await state.repository.read(item.id);
    state.setDetail({ ...item, read_at: item.read_at || new Date().toISOString() });
    state.setView("detail"); await state.refresh();
  }); };
  const close = () => { state.setView("closed"); state.setDetail(null); };
  const title = { closed: "알림", summary: "새로운 공지가 있어요", center: "알림센터", detail: "공지", compose: "공지 작성", manage: "알림센터" }[state.view];
  const current = state.detail && [...state.inbox.items, ...state.inbox.popup].find(n => n.id === state.detail?.id);
  // Details beyond the first page are allowed; revoked/expired details are revalidated by every command.
  const detail = state.detail ? current || state.detail : null;
  return <div className="pn-notifications">
    <Modal open={state.view !== "closed"} title={title} onClose={close} size="medium" resetKey={state.view}>
      <div ref={contentRef} className="pn-notification-content" aria-busy={busy}>
        {(error || state.error) && <p role="alert" className="pn-error">{error || state.error}<button type="button" onClick={() => void state.refresh()}>다시 불러오기</button></p>}
        {state.view === "summary" && <>
          <p className="pn-secondary">한 곳에서 읽고 확인하세요. 닫아도 알림센터에 남습니다.</p>
          <div className="pn-notice-list">{state.inbox.popup.map(n => <NoticeRow key={n.id} item={n} onOpen={open} />)}</div>
          <button className="pn-primary" onClick={() => state.setView("center")}>알림센터에서 보기</button>
        </>}
        {(state.view === "center" || state.view === "manage") && <>
          <div className="pn-center-header">
            <nav className="pn-primary-modes" aria-label="알림센터 메뉴">
              <button aria-pressed={state.view === "center"} onClick={() => state.setView("center")}>받은 알림</button>
              {(state.inbox.can_publish || state.inbox.can_view_receipts) && <button aria-pressed={state.view === "manage"} onClick={() => state.setView("manage")}>보낸 공지</button>}
            </nav>
            {state.inbox.can_publish && <button className="pn-secondary-button pn-compose-action" onClick={() => { if (!publishAttempt) { setSeed(null); setSource(null); } state.setView("compose"); }}><Plus size={16} aria-hidden="true" />공지 작성</button>}
          </div>
          {retractOffer && state.inbox.can_publish && <div className="pn-retract" role="group" aria-label="새 공지 발행 후 기존 공지 회수">
            <p>새 공지를 발행했습니다. 기존 공지를 회수할까요?</p>
            <p className="pn-secondary">{retractOffer.title} · 기존 읽음·확인 기록은 보존됩니다.</p>
            <button className="pn-secondary-button" disabled={busy} onClick={() => setRetractOffer(null)}>기존 공지 유지</button>
            <button className="pn-secondary-button" disabled={busy} onClick={() => void act(async () => { await state.repository.retract(retractOffer.id); setRetractOffer(null); setSentVersion(v => v + 1); await state.refresh(); })}>기존 공지 회수</button>
          </div>}
        </>}
        {state.view === "center" && <>
          {webPushEnabled && <PushSettings userId={state.userId} />}
          <div className="pn-toolbar"><div className="pn-tabs" aria-label="알림 필터">{[false, true].map(v => <button key={String(v)} aria-pressed={unread === v} onClick={() => { setUnread(v); setOffset(0); }}>{v ? `읽지 않음 ${state.inbox.unread_count}` : "전체"}</button>)}</div></div>
          {state.inbox.unacknowledged_count > 0 && <p className="pn-ack-summary">확인 필요한 공지 <b>{state.inbox.unacknowledged_count}건</b> · 읽음과 확인은 별도입니다.</p>}
          {(state.loading || pageLoading) ? <p role="status">알림을 불러오는 중입니다.</p> : <div className="pn-notice-list">{(page || []).map(n => <NoticeRow key={n.id} item={n} onOpen={open} />)}{page?.length === 0 && <p className="pn-empty"><Bell size={25} />{unread ? "읽지 않은 알림이 없습니다." : "새로운 공지가 여기에 표시됩니다."}</p>}</div>}
          <div className="pn-toolbar"><div className="pn-pagination"><button aria-label="이전 알림" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}><ChevronLeft size={16} /></button><span>{offset / 50 + 1} 페이지</span><button aria-label="다음 알림" disabled={page?.length !== 50} onClick={() => setOffset(offset + 50)}><ChevronRight size={16} /></button></div></div>
        </>}
        {state.view === "detail" && detail && <>
          <button className="pn-text-button" onClick={() => state.setView("center")}>← 알림센터</button>
          <p className="pn-notice-meta">{notificationTime(detail.created_at)}{detail.priority === "IMPORTANT" && <span className="pn-important">중요</span>}</p>
          <h3 className="pn-detail-title">{detail.title}</h3><p className="pn-body">{detail.message}</p>
          {detail.expires_at && <p className="pn-secondary">게시 종료 · {notificationTime(detail.expires_at)}</p>}
          {detail.ack_required ? <button className="pn-primary" disabled={busy || !!detail.acknowledged_at} onClick={() => void act(async () => { await state.repository.acknowledge(detail.id); state.setDetail({ ...detail, acknowledged_at: new Date().toISOString() }); await state.refresh(); setToast("공지 확인을 기록했습니다."); })}><Check size={16} />{detail.acknowledged_at ? "확인 완료" : "확인했습니다"}</button> : <button className="pn-primary" onClick={() => state.setView("center")}>확인</button>}
        </>}
        {state.view === "compose" && state.inbox.can_publish && <Composer seed={seed} busy={busy} run={act} attempt={publishAttempt} setAttempt={setPublishAttempt} onPublished={() => { setPublishAttempt(null); setSeed(null); if (source?.state === "PUBLISHED") setRetractOffer(source); setSource(null); setToast("공지를 발행했습니다."); state.setView("manage"); void state.refresh(); }} />}
        {state.view === "manage" && (state.inbox.can_publish || state.inbox.can_view_receipts) && <Manage key={sentVersion} busy={busy} run={act} pending={!!publishAttempt} onDeleted={() => setToast("공지를 삭제했습니다.")} onRepublish={async a => {
          const audience = await state.repository.audience(a.id);
          setSeed({ title: a.title, body: a.body, priority: a.priority === "IMPORTANT" ? "IMPORTANT" : "NORMAL", ackRequired: a.ack_required, ...audience, expiresAt: a.expires_at && new Date(a.expires_at).getTime() > Date.now() ? a.expires_at : null });
          setSource(a); state.setView("compose");
        }} />}
      </div>
    </Modal>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}
function Composer({ seed, busy, run, onPublished, attempt, setAttempt }: { busy: boolean; run: (task: () => Promise<void>) => Promise<void>; onPublished: () => void; seed: ComposeSeed | null; attempt: PublishInput | null; setAttempt: (p: PublishInput | null) => void }) {
  const state = useNotifications()!;
  const initial = attempt || seed;
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [targetError, setTargetError] = useState(false);
  const [title, setTitle] = useState(initial?.title || ""); const [body, setBody] = useState(initial?.body || "");
  const [kind, setKind] = useState<"ALL" | "USER">(initial?.targetKind || "ALL"); const [users, setUsers] = useState<string[]>(initial?.userIds || []);
  const [priority, setPriority] = useState<"NORMAL" | "IMPORTANT">(initial?.priority || "NORMAL"); const [ack, setAck] = useState(initial?.ackRequired || false);
  const [expiry, setExpiry] = useState(initial?.expiresAt ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(initial.expiresAt)).replace(" ", "T") : "");

  useEffect(() => { let live = true; void state.repository.targets().then(r => { if (live) setTargets(r); }).catch(() => { if (live) setTargetError(true); }); return () => { live = false; }; }, [state.repository]);
  const unavailable = kind === "USER" && targets ? users.filter(id => !targets.some(t => t.id === id)) : [];
  const estimate = targets ? kind === "ALL" ? targets.filter(t => t.id !== state.userId).length : users.length : null;
  return <form onSubmit={e => { e.preventDefault(); void run(async () => {
    // Freeze payload and request id after an ambiguous network failure; retry cannot create a second publication.
    const payload: PublishInput = attempt || { requestId: crypto.randomUUID(), title: title.trim(), body: body.trim(), priority, ackRequired: ack, targetKind: kind, userIds: kind === "USER" ? users : [], expiresAt: expiry ? new Date(`${expiry}:00+09:00`).toISOString() : null };
    if (payload.expiresAt && new Date(payload.expiresAt).getTime() <= Date.now()) throw new Error("게시 종료는 현재보다 뒤여야 합니다.");
    if (!attempt && unavailable.length) throw new Error("비활성 또는 확인할 수 없는 기존 대상을 제외해 주세요.");
    setAttempt(payload);
    try { await state.repository.publish(payload); onPublished(); }
    catch (e) { if (e instanceof NotificationFailure && e.definite) setAttempt(null); throw e; }
  }); }} className="pn-composer">
    {seed && <p className="pn-secondary">기존 공지를 바꾸지 않고 새 공지로 발행합니다. 대상과 게시 종료를 확인해 주세요.</p>}
    <fieldset disabled={busy || !!attempt}>
      <label>제목 <span>{title.length}/100</span><input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="직원에게 전할 내용을 적어 주세요" /></label>
      <label>본문 <span>{body.length}/4000</span><textarea required rows={5} maxLength={4000} value={body} onChange={e => setBody(e.target.value)} placeholder="업무에 필요한 내용을 명확하게 안내해 주세요." /></label>
      <label>대상<select value={kind} onChange={e => setKind(e.target.value as "ALL" | "USER")}><option value="ALL">전체 직원</option><option value="USER">특정 직원</option></select></label>
      {targetError && <p role="alert">직원 목록을 불러오지 못했습니다. 닫고 다시 시도해 주세요.</p>}
      {kind === "USER" && <div className="pn-targets">{targets?.map(t => <label key={t.id} className="pn-check"><input type="checkbox" checked={users.includes(t.id)} onChange={e => setUsers(e.target.checked ? [...users, t.id] : users.filter(id => id !== t.id))} />{t.name}{t.id === state.userId ? " (나)" : ""}</label>)}</div>}
      {unavailable.length > 0 && <p role="alert">현재 선택할 수 없는 기존 대상 {unavailable.length}명<button type="button" className="pn-text-button" onClick={() => setUsers(users.filter(id => !unavailable.includes(id)))}>해당 대상 제외</button></p>}
      <p className="pn-secondary">예상 대상 {estimate ?? "확인 중"}명{kind === "ALL" && " · 작성자 본인 제외"}<br />발행 시 활성 직원 기준으로 확정됩니다.</p>
      <div className="pn-form-grid"><label>중요도<select value={priority} onChange={e => setPriority(e.target.value as "NORMAL" | "IMPORTANT")}><option value="NORMAL">일반</option><option value="IMPORTANT">중요</option></select></label><label>게시 종료 (선택 · 한국 시간)<input type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} /></label></div>
      <label className="pn-check"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />직원의 ‘확인했습니다’ 기록 필요</label>
    </fieldset>
    {attempt && !busy && <p className="pn-secondary">발행 결과를 확인하지 못했다면 같은 내용으로 재시도하세요. 중복 발행되지 않습니다.</p>}
    <button type="submit" className="pn-primary" disabled={busy || !targets || (!attempt && unavailable.length > 0) || !title.trim() || !body.trim() || (kind === "USER" && !users.length)}><Megaphone size={16} />{busy ? "발행 중…" : attempt ? "같은 요청 다시 확인" : "지금 발행"}</button>
  </form>;
}
function Manage({ busy, run, onRepublish, pending, onDeleted }: { onDeleted: () => void; onRepublish: (a: Publication) => Promise<void>; pending: boolean; busy: boolean; run: (task: () => Promise<void>) => Promise<void> }) {
  const state = useNotifications()!;
  const [items, setItems] = useState<Publication[]>([]); const [selected, setSelected] = useState<Publication | null>(null);
  const [receipts, setReceipts] = useState<Receipt[] | null>(null); const [confirm, setConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteActionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (deleteConfirm) deleteCancelRef.current?.focus(); else deleteActionRef.current?.focus(); }, [deleteConfirm]);
  const [error, setError] = useState(""); const [offset, setOffset] = useState(0);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backRef.current?.focus(); }, [selected?.id]);
  useEffect(() => { let live = true; void (state.inbox.can_publish ? state.repository.sent(offset) : state.repository.sentForReceiptViewer(state.userId, offset)).then(r => { if (live) setItems(r); }).catch(() => { if (live) setError("보낸 공지를 불러오지 못했습니다."); }); return () => { live = false; }; }, [state.repository, state.inbox.can_publish, state.userId, offset]);
  useEffect(() => {
    if (!selected || !state.inbox.can_view_receipts) return;
    let live = true;
    const load = () => { void state.repository.receipts(selected.id).then(r => { if (live) setReceipts(r); }).catch(() => { if (live) { setReceipts(null); setError("확인 현황을 불러오지 못했습니다."); } }); };
    setReceipts(null); load(); const interval = setInterval(load, 30_000); window.addEventListener("focus", load);
    return () => { live = false; clearInterval(interval); window.removeEventListener("focus", load); };
  }, [state.repository, selected, state.inbox.can_view_receipts]);
  return <>
    <button ref={backRef} className="pn-text-button" onClick={() => selected ? (setSelected(null), setConfirm(false), setDeleteConfirm(false)) : state.setView("center")}>← {selected ? "보낸 공지 목록" : "알림센터"}</button>
    {error && <p role="alert" className="pn-error">{error}</p>}
    {!selected ? <><div className="pn-notice-list">{items.map(a => <button className="pn-notice-row" key={a.id} onClick={() => setSelected(a)}><span className="pn-notice-copy"><span className="pn-notice-meta">{notificationTime(a.published_at)} · {a.state === "RETRACTED" ? "회수됨" : "게시중"}</span><strong>{a.title}</strong><span className="pn-secondary">{a.stats ? `대상 ${a.stats.total} · 읽음 ${a.stats.read} · 확인 ${a.ack_required ? a.stats.ack : "—"} · 미확인 ${a.ack_required ? a.stats.unack : "—"}` : "확인 현황 조회 권한 없음"}</span></span><ChevronRight size={16} /></button>)}{!items.length && <p className="pn-empty">아직 발행한 공지가 없습니다.</p>}</div><div className="pn-pagination"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>이전</button><span>{offset / 50 + 1} 페이지</span><button disabled={items.length < 50} onClick={() => setOffset(offset + 50)}>다음</button></div></> : <>
      <h3 className="pn-detail-title">{selected.title}</h3><p className="pn-secondary">{notificationTime(selected.published_at)} · {selected.state === "RETRACTED" ? "회수됨" : "게시중"}</p><p className="pn-body">{selected.body}</p>
      {state.inbox.can_view_receipts && receipts && <><div className="pn-stat-grid"><span>대상<b>{receipts.length}</b></span><span>읽음<b>{receipts.filter(r => r.read_at).length}</b></span><span>확인<b>{selected.ack_required ? receipts.filter(r => r.acknowledged_at).length : "—"}</b></span><span>미확인<b>{selected.ack_required ? receipts.filter(r => !r.acknowledged_at).length : "—"}</b></span></div>
        <ul className="pn-receipts">{receipts.map(r => <li key={r.recipient_id}><strong>{r.name}{!r.active && <small> · 비활성</small>}</strong><span>{r.read_at ? "읽음" : "안 읽음"} · {selected.ack_required ? r.acknowledged_at ? "확인 완료" : "미확인" : "확인 대상 아님"}</span></li>)}</ul></>}
      {!state.inbox.can_view_receipts && <p className="pn-secondary">확인 현황 조회 권한이 없습니다.</p>}
      {state.inbox.can_publish && <button className="pn-secondary-button pn-republish-action" disabled={busy || pending} onClick={() => void run(() => onRepublish(selected))}>수정해서 다시 보내기</button>}
      {pending && <p className="pn-secondary">발행 결과가 확인되지 않은 요청이 있습니다. 공지 작성에서 먼저 확인해 주세요.</p>}
      {state.inbox.can_publish && selected.state === "PUBLISHED" && (confirm ? <div className="pn-retract"><p>공지를 회수할까요? 직원 알림함에서 제외되며 기존 읽음·확인 기록은 보존됩니다.</p><button className="pn-secondary-button" disabled={busy} onClick={() => setConfirm(false)}>유지</button><button className="pn-secondary-button" disabled={busy} onClick={() => void run(async () => { await state.repository.retract(selected.id); setSelected({ ...selected, state: "RETRACTED" }); setItems(await (state.inbox.can_publish ? state.repository.sent(offset) : state.repository.sentForReceiptViewer(state.userId, offset))); setConfirm(false); await state.refresh(); })}>공지 회수</button></div> : <button className="pn-text-button" disabled={busy} onClick={() => { setDeleteConfirm(false); setConfirm(true); }}>공지 회수…</button>)}
      {state.inbox.can_publish && <div className="pn-delete-actions">
        {deleteConfirm ? <section className="pn-delete-confirm" aria-labelledby="pn-delete-title">
          <h4 id="pn-delete-title">공지를 완전히 삭제할까요?</h4>
          <p>직원 알림센터에서도 사라지며 이 공지의 읽음·확인 기록도 함께 삭제됩니다. 삭제 후에는 복구할 수 없습니다.</p>
          <div className="pn-delete-buttons">
            <button ref={deleteCancelRef} className="pn-secondary-button" disabled={busy} onClick={() => setDeleteConfirm(false)}>취소</button>
            <button className="pn-secondary-button pn-destructive" disabled={busy} onClick={() => void run(async () => {
              await state.repository.deleteAnnouncement(selected.id);
              setSelected(null); setDeleteConfirm(false); setConfirm(false); onDeleted();
              // Do not leave a stale deleted row if canonical refresh fails after the successful command.
              setItems([]);
              try { setItems(await state.repository.sent(offset)); setError(""); }
              catch { setError("삭제는 완료됐지만 목록을 불러오지 못했습니다. 보낸 공지를 다시 열어 주세요."); }
              await state.refresh();
            })}>{busy ? "삭제 중…" : "삭제"}</button>
          </div>
        </section> : <button ref={deleteActionRef} className="pn-text-button pn-destructive" disabled={busy} onClick={() => { setConfirm(false); setDeleteConfirm(true); }}>공지 삭제</button>}
      </div>}
    </>}
  </>;
}
