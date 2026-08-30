import { Archive, BookOpenText, ChevronLeft, ChevronRight, Clipboard, Dog, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchSelect } from "../components/SearchSelect";
import { Badge, Button, Card, FormAlert, Input, Modal, ModalActions } from "../components/ui";
import { formatPhoneForDisplay } from "../lib/phone";
import { seoulDateKey } from "./operationsScheduleRepository";
import { JournalEditor } from "./JournalEditor";
import { journalDeleteConfirmationDetail } from "./journalDeletePresentation";
import { buildUniqueJournalPngFilenames, downloadJournalBatchZip, type JournalBatchFile } from "./journalBatchExport";
import {
  formatJournalBatchDiagnostic,
  getJournalBatchDiagnostic,
  journalBatchFailureMessage,
  JournalBatchDiagnosticSession,
  type JournalBatchDiagnostic,
} from "./journalBatchDiagnostics";
import { renderJournalImageBlob } from "./journalExport";
import { inspectJournalExportPresentation, journalExportOverflowMessage, type JournalExportPresentationIssue } from "./journalExportReadiness";
import { ensureActiveJournalTeacherCommentPresentation, reconnectActiveJournalSystemFont, useJournalCustomFontPreference } from "./journalCustomFont";
import { buildJournalPreviewViewModel, journalEntryToDraft } from "./journalPreviewViewModel";
import {
  fetchJournalEntry,
  fetchJournalDogDirectory,
  fetchJournalRoster,
  registerJournalRoster,
  removeJournalRosterEntry,
  updateJournalDayDefaultActivities,
  type JournalDirectoryDog,
  type JournalRoster,
  type JournalRosterEntry,
  type JournalStatus,
} from "./journalRepository";

type Filter = "ALL" | JournalStatus;

const emptyRoster = (businessDate: string): JournalRoster => ({
  businessDate,
  journalDayId: null,
  defaults: { mannersActivityName: null, physicalActivityName: null, version: null },
  summary: { total: 0, notStarted: 0, inProgress: 0, completed: 0 },
  entries: [],
});

const statusView: Record<JournalStatus, { label: string; tone: "gray" | "blue" | "green" }> = {
  NOT_STARTED: { label: "미작성", tone: "gray" },
  IN_PROGRESS: { label: "작성중", tone: "blue" },
  COMPLETED: { label: "완료", tone: "green" },
};

const dateOffset = (dateKey: string, offset: number) => {
  const value = new Date(`${dateKey}T12:00:00+09:00`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
};

const displayDate = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
    .format(new Date(`${value}T12:00:00+09:00`));

export function JournalHomePage() {
  const today = seoulDateKey();
  const [businessDate, setBusinessDate] = useState(today);
  const [roster, setRoster] = useState<JournalRoster>(() => emptyRoster(today));
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [defaultEditOpen, setDefaultEditOpen] = useState(false);
  const [defaultEditError, setDefaultEditError] = useState("");
  const [directory, setDirectory] = useState<JournalDirectoryDog[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [selectedDogIds, setSelectedDogIds] = useState<string[]>([]);
  const [defaultMannersActivity, setDefaultMannersActivity] = useState("");
  const [defaultPhysicalActivity, setDefaultPhysicalActivity] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<JournalRosterEntry | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [batching, setBatching] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchFailure, setBatchFailure] = useState<JournalBatchDiagnostic | null>(null);
  const [batchDiagnosticCopyState, setBatchDiagnosticCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [batchPresentationIssues, setBatchPresentationIssues] = useState<JournalExportPresentationIssue[]>([]);
  const [batchPhase, setBatchPhase] = useState<"preflight" | "render">("preflight");
  const [teacherCommentFocusEntryId, setTeacherCommentFocusEntryId] = useState<string | null>(null);
  const [reconnectingSystemFont, setReconnectingSystemFont] = useState(false);
  const batchInFlightRef = useRef(false);
  const fontPreference = useJournalCustomFontPreference();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchJournalRoster(businessDate)
      .then((value) => {
        if (cancelled) return;
        const next = value ?? emptyRoster(businessDate);
        setRoster(next);
        setDefaultMannersActivity(next.defaults.mannersActivityName ?? "");
        setDefaultPhysicalActivity(next.defaults.physicalActivityName ?? "");
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "일지 명단을 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessDate]);

  useEffect(() => {
    if (!registerOpen || directory.length || directoryLoading) return;
    setDirectoryLoading(true);
    void fetchJournalDogDirectory()
      .then(setDirectory)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "반려견 목록을 불러오지 못했습니다."))
      .finally(() => setDirectoryLoading(false));
  }, [directory.length, directoryLoading, registerOpen]);

  const existingDogIds = useMemo(() => new Set(roster.entries.map((entry) => entry.dog.id)), [roster.entries]);
  const availableDogs = useMemo(() => directory.filter((dog) => !existingDogIds.has(dog.id)), [directory, existingDogIds]);
  const visibleEntries = useMemo(
    () => filter === "ALL" ? roster.entries : roster.entries.filter((entry) => entry.status === filter),
    [filter, roster.entries],
  );
  const selectedEntry = roster.entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const completedEntries = useMemo(() => roster.entries.filter((entry) => entry.status === "COMPLETED"), [roster.entries]);

  const applyEntryUpdate = useCallback((updated: JournalRosterEntry) => {
    setRoster((current) => {
      const entries = current.entries.map((entry) => entry.id === updated.id ? updated : entry);
      return {
        ...current,
        entries,
        summary: {
          total: entries.length,
          notStarted: entries.filter((entry) => entry.status === "NOT_STARTED").length,
          inProgress: entries.filter((entry) => entry.status === "IN_PROGRESS").length,
          completed: entries.filter((entry) => entry.status === "COMPLETED").length,
        },
      };
    });
  }, []);

  const openRegister = () => {
    setSelectedDogIds([]);
    setDefaultMannersActivity(roster.defaults.mannersActivityName ?? "");
    setDefaultPhysicalActivity(roster.defaults.physicalActivityName ?? "");
    setError("");
    setRegisterOpen(true);
  };

  const register = async () => {
    if (saving || !selectedDogIds.length) return;
    const normalizedManners = defaultMannersActivity.trim();
    const normalizedPhysical = defaultPhysicalActivity.trim();
    setSaving(true);
    setError("");
    try {
      const next = await registerJournalRoster(businessDate, selectedDogIds, {
        mannersActivityName: normalizedManners,
        physicalActivityName: normalizedPhysical,
        expectedVersion: roster.defaults.version,
      });
      setRoster(next);
      setDefaultMannersActivity(next.defaults.mannersActivityName ?? "");
      setDefaultPhysicalActivity(next.defaults.physicalActivityName ?? "");
      setRegisterOpen(false);
      setSelectedDogIds([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "오늘 명단을 등록하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const normalizedDefaultManners = defaultMannersActivity.trim();
  const normalizedDefaultPhysical = defaultPhysicalActivity.trim();
  const defaultsChanged = normalizedDefaultManners !== (roster.defaults.mannersActivityName ?? "")
    || normalizedDefaultPhysical !== (roster.defaults.physicalActivityName ?? "");

  const openDefaultEdit = () => {
    setDefaultMannersActivity(roster.defaults.mannersActivityName ?? "");
    setDefaultPhysicalActivity(roster.defaults.physicalActivityName ?? "");
    setDefaultEditError("");
    setDefaultEditOpen(true);
  };

  const saveDefaults = async () => {
    if (saving || !defaultsChanged || !roster.journalDayId || roster.defaults.version === null) return;
    setSaving(true);
    setDefaultEditError("");
    try {
      const next = await updateJournalDayDefaultActivities(roster.journalDayId, roster.defaults.version, {
        mannersActivityName: normalizedDefaultManners,
        physicalActivityName: normalizedDefaultPhysical,
      });
      setRoster(next);
      setDefaultMannersActivity(next.defaults.mannersActivityName ?? "");
      setDefaultPhysicalActivity(next.defaults.physicalActivityName ?? "");
      setDefaultEditOpen(false);
    } catch (caught) {
      setDefaultEditError(caught instanceof Error ? caught.message : "오늘의 공통 활동을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (entry: JournalRosterEntry) => {
    if (removingId) return;
    setRemovingId(entry.id);
    setError("");
    try {
      setRoster(await removeJournalRosterEntry(entry.id, entry.version));
      setRemoveTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "명단에서 제거하지 못했습니다.");
      setRoster(await fetchJournalRoster(businessDate).catch(() => roster));
    } finally {
      setRemovingId(null);
    }
  };

  const removeFromEditor = async (entry: JournalRosterEntry, expectedVersion: number) => {
    if (removingId) return;
    setRemovingId(entry.id);
    setError("");
    try {
      setRoster(await removeJournalRosterEntry(entry.id, expectedVersion));
      setSelectedEntryId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "일지를 삭제하지 못했습니다.");
      setRoster(await fetchJournalRoster(businessDate).catch(() => roster));
      throw caught;
    } finally {
      setRemovingId(null);
    }
  };

  const batchExport = async () => {
    if (batchInFlightRef.current || !completedEntries.length) return;
    batchInFlightRef.current = true;
    const rosterSnapshot = roster.entries.map((entry) => ({ ...entry }));
    const targets = rosterSnapshot.filter((entry) => entry.status === "COMPLETED");
    const filenames = buildUniqueJournalPngFilenames(targets.map((entry) => ({ dogName: entry.dog.name, businessDate })));
    const files: JournalBatchFile[] = [];
    const diagnostics = new JournalBatchDiagnosticSession(targets.length);
    setBatching(true);
    setBatchProgress({ current: 0, total: targets.length });
    setBatchFailure(null);
    setBatchPresentationIssues([]);
    setBatchPhase("preflight");
    setBatchDiagnosticCopyState("idle");
    setError("");
    try {
      const batchContext = { ordinal: null, entryId: null, dogId: null };
      diagnostics.start("PREPARE", batchContext);
      const teacherCommentPresentation = await ensureActiveJournalTeacherCommentPresentation();
      diagnostics.ack("PREPARE", batchContext);
      const prepared: Array<{ context: { ordinal: number; entryId: string; dogId: string }; viewModel: ReturnType<typeof buildJournalPreviewViewModel> }> = [];
      const presentationIssues: JournalExportPresentationIssue[] = [];
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        const context = { ordinal: index + 1, entryId: target.id, dogId: target.dog.id };
        diagnostics.start("FETCH", context);
        const persisted = await fetchJournalEntry(target.id);
        diagnostics.ack("FETCH", context);
        if (persisted.status !== "COMPLETED" || persisted.businessDate !== businessDate) {
          throw new Error("JOURNAL_BATCH_TARGET_CHANGED");
        }
        const viewModel = buildJournalPreviewViewModel(persisted, journalEntryToDraft(persisted), rosterSnapshot);
        prepared.push({ context, viewModel });
        const issue = inspectJournalExportPresentation({
          ordinal: context.ordinal,
          entryId: context.entryId,
          dogId: context.dogId,
          viewModel,
          presentation: teacherCommentPresentation,
        });
        if (issue) presentationIssues.push(issue);
        setBatchProgress({ current: index + 1, total: targets.length });
      }
      if (presentationIssues.length) {
        diagnostics.presentationIssues(presentationIssues.map((issue) => {
          const { dogName, ...diagnosticIssue } = issue;
          void dogName;
          return diagnosticIssue;
        }));
        setBatchPresentationIssues(presentationIssues);
        const first = presentationIssues[0];
        diagnostics.start("PREPARE", { ordinal: first.ordinal, entryId: first.entryId, dogId: first.dogId });
        throw new Error("JOURNAL_BATCH_PRESENTATION_OVERFLOW");
      }
      setBatchPhase("render");
      setBatchProgress({ current: 0, total: targets.length });
      for (let index = 0; index < prepared.length; index += 1) {
        const { context, viewModel } = prepared[index];
        const blob = await renderJournalImageBlob(viewModel, "png", (event) => {
          if (event.state === "START") diagnostics.start(event.stage, context);
          else diagnostics.ack(event.stage, context, event);
        }, teacherCommentPresentation);
        files.push({ filename: filenames[index], blob });
        diagnostics.entryComplete(context, blob.size);
        setBatchProgress({ current: index + 1, total: targets.length });
      }
      await downloadJournalBatchZip(files, businessDate, (event) => {
        if (event.state === "START") diagnostics.start(event.stage, batchContext);
        else diagnostics.ack(event.stage, batchContext, event);
      });
      diagnostics.complete();
    } catch (caught) {
      const failure = diagnostics.fail(caught).diagnostic;
      setBatchFailure(failure);
      setError(journalBatchFailureMessage(failure.failure!));
    } finally {
      setBatching(false);
      batchInFlightRef.current = false;
    }
  };

  const reconnectSystemFont = async () => {
    if (reconnectingSystemFont) return;
    setReconnectingSystemFont(true);
    setError("");
    try {
      await reconnectActiveJournalSystemFont();
      setBatchFailure(null);
      setBatchPresentationIssues([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "컴퓨터 글꼴을 다시 연결하지 못했습니다.");
    } finally {
      setReconnectingSystemFont(false);
    }
  };

  const copyBatchDiagnostic = async () => {
    if (!batchFailure) return;
    const diagnostic = getJournalBatchDiagnostic(batchFailure.batchId) ?? batchFailure;
    const text = formatJournalBatchDiagnostic(diagnostic);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("JOURNAL_BATCH_DIAGNOSTIC_COPY_FAILED");
      }
      setBatchDiagnosticCopyState("copied");
    } catch {
      setBatchDiagnosticCopyState("error");
    }
  };

  if (selectedEntry) {
    return (
      <JournalEditor
        key={selectedEntry.id}
        entry={selectedEntry}
        rosterEntries={roster.entries}
        onDelete={(expectedVersion) => removeFromEditor(selectedEntry, expectedVersion)}
        onEntryUpdate={applyEntryUpdate}
        onNavigate={setSelectedEntryId}
        onClose={() => setSelectedEntryId(null)}
        focusTeacherComment={teacherCommentFocusEntryId === selectedEntry.id}
      />
    );
  }

  return (
    <section className="mx-auto max-w-5xl overflow-x-hidden" aria-label="유치원 하루 일지">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold tracking-[0.17em] text-primary">P&amp;M JOURNAL</p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-[-0.035em] text-text-primary sm:text-[1.75rem]">오늘의 일지</h1>
          <p className="mt-1 text-sm text-text-secondary">유치원 하루 일지 작성 대상을 관리합니다.</p>
        </div>
        <div className="flex items-center gap-1 rounded-2xl border border-border bg-surface p-1 shadow-sm">
          <button type="button" aria-label="이전 날짜" className="flex h-11 w-11 items-center justify-center rounded-xl text-text-secondary hover:bg-primary-soft hover:text-primary" onClick={() => setBusinessDate(dateOffset(businessDate, -1))}><ChevronLeft size={19} /></button>
          <label className="min-w-0">
            <span className="sr-only">일지 날짜</span>
            <Input type="date" aria-label="일지 날짜" className="min-h-11 min-w-0 border-0 px-2 shadow-none" value={businessDate} max={today} onChange={(event) => event.target.value && setBusinessDate(event.target.value)} />
          </label>
          <button type="button" aria-label="다음 날짜" disabled={businessDate >= today} className="flex h-11 w-11 items-center justify-center rounded-xl text-text-secondary hover:bg-primary-soft hover:text-primary disabled:opacity-30" onClick={() => setBusinessDate(dateOffset(businessDate, 1))}><ChevronRight size={19} /></button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div><strong className="text-base text-text-primary">{displayDate(businessDate)}</strong>{roster.summary.total ? <span className="ml-2 text-sm text-text-secondary">· {roster.summary.total}마리</span> : null}</div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 flex-1 sm:flex-none"
            disabled={!completedEntries.length || batching}
            aria-label={`${businessDate} 완료 일지 전체 저장`}
            title={!completedEntries.length ? "저장할 완료 일지가 없습니다." : undefined}
            onClick={() => void batchExport()}
          >
            {batching ? <LoaderCircle className="animate-spin" size={17} /> : <Archive size={17} />}
            {batching
              ? batchPhase === "preflight"
                ? `저장 가능 여부 확인 중 ${batchProgress.current} / ${batchProgress.total}`
                : `일지 이미지 만드는 중 ${batchProgress.current} / ${batchProgress.total}`
              : `완료 일지 전체 저장 · ${completedEntries.length}건`}
          </Button>
          <Button type="button" className="flex-1 sm:flex-none" onClick={openRegister}><Plus size={17} />{roster.summary.total ? "등원 추가" : "오늘 등원 등록"}</Button>
        </div>
      </div>

      {!loading && roster.journalDayId ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm" aria-label="오늘의 공통 활동 요약">
          <div className="min-w-0">
            <p className="text-sm font-bold text-text-primary">오늘의 공통 활동</p>
            {roster.defaults.mannersActivityName || roster.defaults.physicalActivityName ? (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
                <span>예절 <strong className="font-semibold text-text-primary">{roster.defaults.mannersActivityName || "설정 안 됨"}</strong></span>
                <span>체육 <strong className="font-semibold text-text-primary">{roster.defaults.physicalActivityName || "설정 안 됨"}</strong></span>
              </div>
            ) : <p className="mt-1 text-sm text-text-muted">설정 안 됨</p>}
          </div>
          <Button type="button" variant="secondary" className="min-h-10 shrink-0 px-3" onClick={openDefaultEdit}>
            <Pencil size={15} />{roster.defaults.mannersActivityName || roster.defaults.physicalActivityName ? "수정" : "설정"}
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 space-y-2">
          <FormAlert>{error}</FormAlert>
          {batchFailure ? (
            <div className="space-y-3">
              {batchPresentationIssues.length ? (
                <div className="rounded-xl border border-warning/30 bg-warning-soft p-3" aria-label="이미지 저장 수정 대상">
                  <p className="text-sm font-bold text-text-primary">수정이 필요한 일지 {batchPresentationIssues.length}건</p>
                  <ul className="mt-2 space-y-2">
                    {batchPresentationIssues.map((issue) => (
                      <li key={issue.entryId} className="flex flex-col gap-2 rounded-lg bg-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 text-sm text-text-primary">
                          <strong>{issue.dogName}</strong>
                          <span className="ml-1 text-text-secondary">· 현재 {issue.fontSize}px · {journalExportOverflowMessage(issue)}</span>
                        </div>
                        <Button type="button" variant="secondary" className="min-h-10 shrink-0" onClick={() => { setTeacherCommentFocusEntryId(issue.entryId); setSelectedEntryId(issue.entryId); }}>
                          <Pencil size={15} />일지 수정하기
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
              {batchFailure.failure?.safeErrorMessage === "JOURNAL_SYSTEM_FONT_RECONNECT_REQUIRED" && fontPreference.systemFontStatus !== "unsupported" ? (
                <Button type="button" onClick={() => void reconnectSystemFont()} disabled={reconnectingSystemFont}>
                  {reconnectingSystemFont ? <LoaderCircle className="animate-spin" size={16} /> : null}
                  컴퓨터 글꼴 다시 연결
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={() => void copyBatchDiagnostic()}>
                <Clipboard size={16} />
                {batchDiagnosticCopyState === "copied" ? "진단 정보 복사됨" : batchDiagnosticCopyState === "error" ? "진단 정보 복사 실패" : "진단 정보 복사"}
              </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {loading ? (
        <Card className="mt-5 flex min-h-64 items-center justify-center p-8"><div className="flex items-center gap-2 text-sm text-text-secondary"><LoaderCircle className="animate-spin" size={18} />명단 불러오는 중</div></Card>
      ) : roster.summary.total === 0 ? (
        <Card className="mt-5 px-5 py-14 text-center sm:py-20">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary"><BookOpenText size={26} /></span>
          <h2 className="mt-5 text-lg font-bold text-text-primary">오늘 등원한 아이들을 등록해주세요.</h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">등록한 명단이 하루 일지의 canonical 작성 대상이 됩니다.</p>
          <Button type="button" className="mt-6" onClick={openRegister}><Dog size={17} />오늘 등원 등록</Button>
        </Card>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3" aria-label="일지 요약">
            <Summary label="완료" value={roster.summary.completed} tone="green" />
            <Summary label="작성중" value={roster.summary.inProgress} tone="blue" />
            <Summary label="미작성" value={roster.summary.notStarted} tone="gray" />
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="일지 상태 필터">
            {([['ALL','전체'],['NOT_STARTED','미작성'],['IN_PROGRESS','작성중'],['COMPLETED','완료']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={filter===value} onClick={() => setFilter(value)} className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold ${filter===value?'bg-primary text-white':'border border-border bg-surface text-text-secondary hover:bg-primary-soft'}`}>{label}</button>)}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="오늘의 일지 명단">
            {visibleEntries.map((entry) => <JournalEntryCard key={entry.id} entry={entry} removing={removingId===entry.id} onOpen={() => setSelectedEntryId(entry.id)} onRemove={() => setRemoveTarget(entry)} />)}
            {!visibleEntries.length ? <Card className="p-8 text-center text-sm text-text-muted sm:col-span-2 xl:col-span-3">이 상태의 일지가 없습니다.</Card> : null}
          </div>
        </>
      )}

      <Modal open={registerOpen} title="오늘 등원 등록" description={`${displayDate(businessDate)} · P&M 유치원`} size="large" onClose={() => !saving && setRegisterOpen(false)} resetKey={businessDate}>
        {directoryLoading ? <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-text-secondary"><LoaderCircle className="animate-spin" size={18} />반려견 목록 불러오는 중</div> : (
          <SearchSelect
            label="반려견 선택"
            labelAccessory={<span className="shrink-0 text-xs font-semibold text-text-secondary">선택 {selectedDogIds.length}마리</span>}
            items={availableDogs}
            selectedIds={selectedDogIds}
            onChange={setSelectedDogIds}
            getItemId={(dog) => dog.id}
            getSearchText={(dog) => `${dog.name} ${dog.customerName ?? ""} ${dog.customerPhone ?? ""}`}
            renderOption={(dog) => <span className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Dog size={18} /></span><span className="min-w-0"><strong className="block truncate text-sm text-text-primary">{dog.name}</strong><span className="mt-0.5 block truncate text-xs text-text-secondary">{dog.customerName || "보호자 이름 미등록"} · {formatPhoneForDisplay(dog.customerPhone) || "전화번호 미등록"}</span></span></span>}
            renderSelected={(dog) => `${dog.name} · ${dog.customerName || "보호자 미등록"}`}
            placeholder="반려견, 보호자 또는 전화번호 검색"
            emptyMessage="검색어를 입력하거나 최근 반려견을 선택하세요."
            noResultsMessage="등록 가능한 반려견이 없습니다."
            multiple
            showAllOnEmpty
            disabled={saving}
            recentStorageKey="pm-os:journal-roster:dogs"
            resultsPresentation="inline"
          />
        )}
        <fieldset disabled={saving} className="mt-5 rounded-2xl bg-surface-secondary/70 p-4">
          <legend className="px-1 text-sm font-bold text-text-primary">오늘의 공통 활동 <span className="ml-1 text-xs font-medium text-text-muted">선택 입력</span></legend>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-text-secondary">
              예절교육
              <Input className="mt-1.5 min-h-11" value={defaultMannersActivity} maxLength={80} onChange={(event) => setDefaultMannersActivity(event.target.value)} placeholder="예절교육 활동명 입력" />
            </label>
            <label className="block text-sm font-semibold text-text-secondary">
              체육활동
              <Input className="mt-1.5 min-h-11" value={defaultPhysicalActivity} maxLength={80} onChange={(event) => setDefaultPhysicalActivity(event.target.value)} placeholder="체육활동 활동명 입력" />
            </label>
          </div>
        </fieldset>
        <ModalActions stickyDesktop><Button type="button" variant="secondary" disabled={saving} onClick={() => setRegisterOpen(false)}>취소</Button><Button type="button" disabled={!selectedDogIds.length || saving || directoryLoading} onClick={() => void register()}>{saving ? "저장 중..." : selectedDogIds.length ? `${selectedDogIds.length}마리 등원 등록` : "등원 등록"}</Button></ModalActions>
      </Modal>

      <Modal
        open={defaultEditOpen}
        title="오늘의 공통 활동 수정"
        description={`${displayDate(businessDate)} · 이후 신규 등록 일지에 적용됩니다.`}
        onClose={() => !saving && setDefaultEditOpen(false)}
        resetKey={`${businessDate}:${roster.defaults.version ?? "none"}`}
      >
        <fieldset disabled={saving} className="space-y-4">
          <label className="block text-sm font-semibold text-text-secondary">
            예절교육
            <Input className="mt-1.5 min-h-11" value={defaultMannersActivity} maxLength={80} onChange={(event) => setDefaultMannersActivity(event.target.value)} placeholder="예절교육 활동명 입력" />
          </label>
          <label className="block text-sm font-semibold text-text-secondary">
            체육활동
            <Input className="mt-1.5 min-h-11" value={defaultPhysicalActivity} maxLength={80} onChange={(event) => setDefaultPhysicalActivity(event.target.value)} placeholder="체육활동 활동명 입력" />
          </label>
        </fieldset>
        {defaultEditError ? <div className="mt-4"><FormAlert>{defaultEditError}</FormAlert></div> : null}
        <ModalActions>
          <Button type="button" variant="secondary" disabled={saving} onClick={() => setDefaultEditOpen(false)}>취소</Button>
          <Button type="button" disabled={saving || !defaultsChanged} onClick={() => void saveDefaults()}>{saving ? "저장 중..." : "저장"}</Button>
        </ModalActions>
      </Modal>

      <Modal
        open={removeTarget !== null}
        title="일지 삭제"
        description={removeTarget ? `${removeTarget.dog.name}의 ${displayDate(removeTarget.businessDate)} 일지를 삭제할까요? ${journalDeleteConfirmationDetail(removeTarget.status)}` : undefined}
        onClose={() => { if (!removingId) setRemoveTarget(null); }}
        resetKey={removeTarget ? `${removeTarget.id}:${removeTarget.version}` : "journal-delete"}
      >
        <ModalActions>
          <Button type="button" variant="secondary" disabled={Boolean(removingId)} onClick={() => setRemoveTarget(null)}>취소</Button>
          <Button type="button" data-modal-initial variant="danger" disabled={Boolean(removingId)} onClick={() => removeTarget && void remove(removeTarget)}>
            {removingId ? <LoaderCircle className="animate-spin" size={17} /> : <Trash2 size={17} />}{removingId ? "삭제 중..." : "삭제"}
          </Button>
        </ModalActions>
      </Modal>

    </section>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: "green" | "blue" | "gray" }) {
  const colors = tone === "green" ? "bg-success-soft text-success" : tone === "blue" ? "bg-primary-soft text-primary" : "bg-surface-secondary text-text-secondary";
  return <div className={`rounded-2xl px-3 py-4 text-center ${colors}`}><strong className="block text-xl tabular-nums">{value}</strong><span className="mt-1 block text-xs font-semibold">{label}</span></div>;
}

function JournalEntryCard({ entry, removing, onOpen, onRemove }: { entry: JournalRosterEntry; removing: boolean; onOpen: () => void; onRemove: () => void }) {
  const view = statusView[entry.status];
  return <Card variant="interactive" className="min-w-0 p-4">
    <div className="flex min-w-0 items-start justify-between gap-3">
      <button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={onOpen} aria-label={`${entry.dog.name} ${entry.status === "NOT_STARTED" ? "일지 작성" : entry.status === "IN_PROGRESS" ? "일지 이어서 작성" : "일지 보기 및 수정"}`}>
        <div className="flex items-center gap-2"><strong className="truncate text-base text-text-primary">{entry.dog.name}</strong><Badge tone={view.tone}>{view.label}</Badge></div>
        <p className="mt-1 truncate text-sm text-text-secondary">{entry.customer.name || "보호자 이름 미등록"}</p>
        <p className="mt-2 text-xs font-semibold text-primary">{entry.status === "NOT_STARTED" ? "작성" : entry.status === "IN_PROGRESS" ? "이어서 작성" : "보기/수정"}</p>
      </button>
      <button type="button" aria-label={`${entry.dog.name} 일지 삭제`} disabled={removing} onClick={onRemove} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-muted hover:bg-error-soft hover:text-error disabled:opacity-50">{removing?<LoaderCircle className="animate-spin" size={17}/>:<Trash2 size={17}/>}</button>
    </div>
  </Card>;
}
