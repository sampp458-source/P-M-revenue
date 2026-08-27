import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clipboard, Download, Eye, Image, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Card, FormAlert, Input, Modal, ModalActions, Textarea } from "../components/ui";
import { JournalAutosaveQueue, type JournalSaveState } from "./journalAutosave";
import {
  JournalPersistenceError,
  formatJournalFailureDiagnostic,
  getJournalFailureDiagnostic,
  journalValidationShape,
  type JournalPersistenceFailureKind,
  type JournalSaveFailureDiagnostic,
} from "./journalPersistenceDiagnostics";
import { journalDeleteConfirmationDetail } from "./journalDeletePresentation";
import { exportJournalImage, type JournalExportFormat } from "./journalExport";
import { JournalReportPreview } from "./JournalReportTemplate";
import { buildJournalPreviewViewModel, journalEntryToDraft } from "./journalPreviewViewModel";
import { normalizeJournalTeacherComment } from "./journalTextNormalization";
import {
  completeJournalEntry,
  fetchJournalEntry,
  updateJournalEntryDraft,
  type JournalCondition,
  type JournalDraft,
  type JournalFriendRelationship,
  type JournalMannersEvaluation,
  type JournalMeal,
  type JournalPhysicalEvaluation,
  type JournalRosterEntry,
  type JournalStoolCondition,
  type JournalTeacherRelationship,
} from "./journalRepository";

export const JOURNAL_COMMENT_MAX_LENGTH = 500;
export const JOURNAL_AUTOSAVE_DELAY = 800;

const conditionOptions: Array<[JournalCondition, string]> = [
  ["active", "활발해요"], ["calm", "평온해요"], ["tired", "피곤해요"], ["sensitive", "예민해요"],
];
const stoolOptions: Array<[JournalStoolCondition, string]> = [
  ["good", "좋아요"], ["very_loose", "아주 묽어요"], ["slightly_loose", "조금 묽어요"], ["poor", "상태 안 좋아요"],
];
const mealOptions: Array<[JournalMeal, string]> = [
  ["brought_food", "가져온 사료"], ["daycare_food", "유치원 사료"], ["brought_snack", "가져온 간식"], ["daycare_snack", "유치원 간식"],
];
const teacherOptions: Array<[JournalTeacherRelationship, string]> = [
  ["loves_teacher", "선생님 너무 좋아요"], ["prefers_friends", "친구가 더 좋아요"], ["uncomfortable_with_teacher", "아직은 선생님이 불편해요"],
];
const friendOptions: Array<[JournalFriendRelationship, string]> = [
  ["loves_friends", "친구 너무 좋아요"], ["prefers_teacher", "선생님이 더 좋아요"], ["uncomfortable_with_friends", "아직은 친구가 불편해요"],
];
const mannersOptions: Array<[JournalMannersEvaluation, string]> = [
  ["excellent", "참 잘했어요"], ["can_improve", "다음엔 더 잘할 수 있어요"], ["difficult", "아직은 어려워요"],
];
const physicalOptions: Array<[JournalPhysicalEvaluation, string]> = [
  ["champion", "나는야 체육왕"], ["fun", "너무 재미있었어요"], ["rest", "오늘은 쉴래요"],
];

const displayDate = (date: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(`${date}T12:00:00+09:00`));

const journalFailureMessage = (kind: JournalPersistenceFailureKind) => {
  if (kind === "VERSION_CONFLICT") return "다른 변경사항이 먼저 저장되었습니다.";
  if (kind === "PERMISSION") return "현재 계정으로 일지를 저장할 수 없습니다.";
  if (kind === "TIMEOUT") return "서버 응답이 지연되고 있습니다.";
  if (kind === "ABORT") return "저장 요청이 중단되었습니다.";
  if (kind === "NETWORK") return "네트워크 연결을 확인해 주세요.";
  if (kind === "VALIDATION" || kind === "REQUEST_CONFLICT") return "저장 요청을 확인할 수 없습니다.";
  return "저장 중 오류가 발생했습니다.";
};

export function JournalEditor({
  entry: rosterEntry,
  rosterEntries,
  onDelete,
  onEntryUpdate,
  onNavigate,
  onClose,
}: {
  entry: JournalRosterEntry;
  rosterEntries: JournalRosterEntry[];
  onDelete?: (expectedVersion: number) => Promise<void>;
  onEntryUpdate: (entry: JournalRosterEntry) => void;
  onNavigate: (entryId: string) => void;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState(rosterEntry);
  const [draft, setDraft] = useState<JournalDraft>(() => journalEntryToDraft(rosterEntry));
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<JournalSaveState>("idle");
  const [saveFailure, setSaveFailure] = useState<JournalSaveFailureDiagnostic | null>(null);
  const [diagnosticCopyState, setDiagnosticCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState<JournalExportFormat | null>(null);
  const [exportError, setExportError] = useState("");
  const versionRef = useRef(rosterEntry.version);
  const entryStatusRef = useRef(rosterEntry.status);
  const rosterEntriesRef = useRef(rosterEntries);
  rosterEntriesRef.current = rosterEntries;
  const queueRef = useRef<JournalAutosaveQueue<JournalDraft, JournalRosterEntry> | null>(null);
  const exportInFlightRef = useRef(false);
  const [navigationIntent, setNavigationIntent] = useState<"list" | string | null>(null);
  const [navigationRecovery, setNavigationRecovery] = useState(false);
  const navigationInFlightRef = useRef(false);
  const pendingNavigationRef = useRef<{ intent: "list" | string; navigate: () => void } | null>(null);
  const actionInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setSaveFailure(null);
    void fetchJournalEntry(rosterEntry.id)
      .then((loaded) => {
        if (cancelled) return;
        setEntry(loaded);
        setDraft(journalEntryToDraft(loaded));
        versionRef.current = loaded.version;
        entryStatusRef.current = loaded.status;
        queueRef.current = new JournalAutosaveQueue(
          loaded.version,
          (snapshot, expectedVersion, requestId, signal) =>
            updateJournalEntryDraft(loaded.id, expectedVersion, snapshot, requestId, signal, entryStatusRef.current),
          (result) => {
            versionRef.current = result.version;
            entryStatusRef.current = result.status;
            setEntry(result);
            onEntryUpdate(result);
          },
          setSaveState,
          JOURNAL_AUTOSAVE_DELAY,
          undefined,
          undefined,
          undefined,
          {
            context: () => ({ entryId: loaded.id, entryStatus: entryStatusRef.current }),
            onFailure: (diagnostic) => {
              setSaveFailure(diagnostic);
              if (diagnostic) setDiagnosticCopyState("idle");
            },
            validationShape: (snapshot) => journalValidationShape(
              snapshot,
              rosterEntriesRef.current.map((item) => item.dog.id),
            ),
          },
        );
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "일지를 불러오지 못했습니다."))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      queueRef.current?.dispose();
      queueRef.current = null;
    };
  }, [onEntryUpdate, rosterEntry.id]);

  const position = rosterEntries.findIndex((item) => item.id === rosterEntry.id);
  const previous = position > 0 ? rosterEntries[position - 1] : null;
  const next = position >= 0 && position < rosterEntries.length - 1 ? rosterEntries[position + 1] : null;
  const nextIncomplete = useMemo(
    () => rosterEntries.find((item) => item.id !== entry.id && item.status !== "COMPLETED") ?? null,
    [entry.id, rosterEntries],
  );
  const friendOptionsForDay = rosterEntries.filter((item) => item.dog.id !== entry.dog.id);
  const previewViewModel = useMemo(() => buildJournalPreviewViewModel(entry, draft, rosterEntries), [draft, entry, rosterEntries]);

  const update = (change: (current: JournalDraft) => JournalDraft) => {
    if (actionInFlightRef.current) return;
    setDraft((current) => {
      const nextDraft = change(current);
      queueRef.current?.schedule(nextDraft);
      setError("");
      return nextDraft;
    });
  };

  const flush = async () => {
    try {
      const queue = queueRef.current;
      if (queue) await queue.flush(queue.getDraftRevision());
      return true;
    } catch (caught) {
      setError(caught instanceof JournalPersistenceError ? journalFailureMessage(caught.kind) : caught instanceof Error ? caught.message : "일지를 저장하지 못했습니다.");
      return false;
    }
  };

  const continueNavigationAfterSave = async () => {
    const attempt = pendingNavigationRef.current;
    if (!attempt || navigationInFlightRef.current) return;
    navigationInFlightRef.current = true;
    setNavigationRecovery(false);
    setNavigationIntent(attempt.intent);
    try {
      const queue = queueRef.current;
      if (queue) {
        while (pendingNavigationRef.current === attempt) {
          const targetRevision = queue.getDraftRevision();
          await queue.flush(targetRevision);
          if (queue.getSavedRevision() >= targetRevision && queue.getDraftRevision() === targetRevision) break;
        }
      }
      if (pendingNavigationRef.current !== attempt) return;
      pendingNavigationRef.current = null;
      attempt.navigate();
    } catch {
      setNavigationRecovery(true);
    } finally {
      navigationInFlightRef.current = false;
      setNavigationIntent(null);
    }
  };

  const navigateAfterSave = async (intent: "list" | string, navigate: () => void) => {
    if (navigationInFlightRef.current || pendingNavigationRef.current) return;
    pendingNavigationRef.current = { intent, navigate };
    await continueNavigationAfterSave();
  };

  const retryNavigation = () => {
    if (!pendingNavigationRef.current) return;
    void continueNavigationAfterSave();
  };

  const continueEditing = () => {
    pendingNavigationRef.current = null;
    setNavigationRecovery(false);
    setNavigationIntent(null);
    setError("");
    queueRef.current?.dismissError();
  };

  const copyFailureDiagnostic = async () => {
    if (!saveFailure) return;
    const diagnostic = getJournalFailureDiagnostic(saveFailure.diagnosticId) ?? saveFailure;
    const text = formatJournalFailureDiagnostic(diagnostic);
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
        if (!copied) throw new Error("JOURNAL_DIAGNOSTIC_COPY_FAILED");
      }
      setDiagnosticCopyState("copied");
    } catch {
      setDiagnosticCopyState("error");
    }
  };

  const move = async (targetId: string) => {
    await navigateAfterSave(targetId, () => onNavigate(targetId));
  };

  const close = async () => {
    await navigateAfterSave("list", onClose);
  };

  const complete = async () => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setCompleting(true);
    setError("");
    try {
      if (!(await flush())) return;
      const completed = await completeJournalEntry(entry.id, versionRef.current);
      versionRef.current = completed.version;
      entryStatusRef.current = completed.status;
      queueRef.current?.acknowledgeExternalVersion(completed.version);
      setEntry(completed);
      onEntryUpdate(completed);
      setSaveState("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "작성 완료 처리에 실패했습니다.");
    } finally {
      setCompleting(false);
      actionInFlightRef.current = false;
    }
  };

  const remove = async () => {
    if (!onDelete || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setDeleting(true);
    setError("");
    try {
      if (!(await flush())) return;
      await onDelete(versionRef.current);
      queueRef.current?.dispose();
      setDeleteOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "일지를 삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
      actionInFlightRef.current = false;
    }
  };

  const exportImage = async (format: JournalExportFormat) => {
    if (exportInFlightRef.current) return;
    const capturedViewModel = previewViewModel;
    exportInFlightRef.current = true;
    setExporting(format);
    setExportError("");
    try {
      await exportJournalImage(capturedViewModel, format);
    } catch {
      setExportError("이미지를 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      exportInFlightRef.current = false;
      setExporting(null);
    }
  };

  if (loading) return <Card className="flex min-h-72 items-center justify-center"><LoaderCircle className="animate-spin text-primary" /></Card>;

  return (
    <section className="mx-auto max-w-[1600px] overflow-x-hidden pb-24 xl:h-[calc(100dvh-110px)] xl:pb-0" aria-label={`${entry.dog.name} 일지 편집기`}>
      <div className="flex min-h-0 flex-col gap-3 xl:grid xl:h-full xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,1fr)] xl:items-stretch xl:gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(480px,1fr)] 2xl:gap-5">
        <div className="journal-editor-form-scrollbar order-3 min-w-0 xl:order-none xl:h-full xl:overflow-y-auto xl:overscroll-contain xl:pb-8 xl:pr-1.5" data-testid="journal-editor-form-scroll">
          <fieldset disabled={completing || deleting} className="space-y-3 disabled:opacity-70">
        <EditorSection title="컨디션" description="하나 이상 선택해 주세요.">
          <MultiChips options={conditionOptions} values={draft.conditionCodes} onChange={(conditionCodes) => update((value) => ({ ...value, conditionCodes }))} />
        </EditorSection>

        <EditorSection title="배변">
          <BinaryChoice label="소변" value={draft.urination} onChange={(urination) => update((current) => ({ ...current, urination }))} />
          <div className="mt-3"><BinaryChoice label="대변" value={draft.defecation} onChange={(defecation) => update((current) => ({ ...current, defecation, stoolCondition: defecation ? current.stoolCondition : null }))} /></div>
          <div className="mt-3">
            <span className="mb-2 block text-sm font-semibold text-text-primary">대변 상태</span>
            <SingleChips options={stoolOptions} value={draft.stoolCondition} disabled={draft.defecation !== true} onChange={(stoolCondition) => update((current) => ({ ...current, stoolCondition }))} />
          </div>
        </EditorSection>

        <EditorSection title="먹은 것" description="선택하지 않아도 됩니다.">
          <MultiChips options={mealOptions} values={draft.mealCodes} onChange={(mealCodes) => update((value) => ({ ...value, mealCodes }))} />
        </EditorSection>

        <EditorSection title="관계">
          <LabeledSingle label="선생님과" options={teacherOptions} value={draft.teacherRelationship} onChange={(teacherRelationship) => update((current) => ({ ...current, teacherRelationship }))} />
          <div className="mt-3"><LabeledSingle label="친구들과" options={friendOptions} value={draft.friendRelationship} onChange={(friendRelationship) => update((current) => ({ ...current, friendRelationship }))} /></div>
        </EditorSection>

        <EditorSection title="제일 친한 친구" description="오늘 등원한 다른 반려견 중 선택할 수 있습니다.">
          <select aria-label="제일 친한 친구" className="min-h-11 w-full rounded-xl border border-border-strong bg-surface px-3 text-sm text-text-primary" value={draft.bestFriendDogId ?? ""} onChange={(event) => update((current) => ({ ...current, bestFriendDogId: event.target.value || null }))}>
            <option value="">선택 안 함</option>
            {friendOptionsForDay.map((item) => <option key={item.dog.id} value={item.dog.id}>{item.dog.name}</option>)}
          </select>
        </EditorSection>

        <ActivitySection title="예절교육" activity={draft.mannersActivityName} evaluation={draft.mannersEvaluation} options={mannersOptions} onActivity={(mannersActivityName) => update((current) => ({ ...current, mannersActivityName }))} onEvaluation={(mannersEvaluation) => update((current) => ({ ...current, mannersEvaluation }))} />
        <ActivitySection title="체육" activity={draft.physicalActivityName} evaluation={draft.physicalEvaluation} options={physicalOptions} onActivity={(physicalActivityName) => update((current) => ({ ...current, physicalActivityName }))} onEvaluation={(physicalEvaluation) => update((current) => ({ ...current, physicalEvaluation }))} />

        <EditorSection title="선생님의 한마디" description="작성 완료를 위해 한마디를 입력해 주세요.">
          <Textarea aria-label="선생님의 한마디" rows={6} maxLength={JOURNAL_COMMENT_MAX_LENGTH} value={draft.teacherComment} onChange={(event) => update((current) => ({ ...current, teacherComment: normalizeJournalTeacherComment(event.target.value) }))} placeholder="오늘 하루의 특별한 모습을 기록해 주세요." className="min-h-36 resize-y" />
          <p className="mt-2 text-right text-xs tabular-nums text-text-muted">{draft.teacherComment.length} / {JOURNAL_COMMENT_MAX_LENGTH}</p>
        </EditorSection>
          </fieldset>
        </div>

        <aside className="journal-editor-control-panel contents xl:sticky xl:top-[78px] xl:grid xl:h-full xl:min-h-0 xl:grid-rows-[auto_auto_minmax(0,1fr)_auto] xl:gap-0.5 xl:overflow-hidden xl:rounded-2xl" aria-label={`${previewViewModel.dogName} 일지 작업 패널`} data-testid="journal-editor-control-panel">
          <header className="order-1 rounded-2xl border border-border bg-surface p-3 shadow-sm sm:p-4 xl:order-none xl:px-3 xl:py-0.5">
            <div className="flex min-h-11 items-center gap-3 xl:min-h-9 xl:gap-2.5 xl:pr-44">
              <button type="button" aria-busy={navigationIntent === "list"} disabled={completing || deleting} onClick={() => void close()} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-text-secondary hover:bg-primary-soft hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 xl:min-h-9 xl:py-1">{navigationIntent === "list" ? <LoaderCircle className="animate-spin" size={18} /> : <ArrowLeft size={18} />}목록</button>
              <div className="min-w-0 flex-1 border-l border-border pl-3">
                <h1 className="truncate text-lg font-bold text-text-primary sm:text-xl">{entry.dog.name}</h1>
                <p className="truncate text-xs text-text-secondary sm:text-sm">{displayDate(entry.businessDate)} · {entry.status === "COMPLETED" ? "완료" : entry.status === "IN_PROGRESS" ? "작성중" : "미작성"} · <SaveState state={saveState} failure={saveFailure} /></p>
              </div>
            </div>
            <nav className="mt-2 grid grid-cols-3 items-center gap-2 border-t border-border pt-2 xl:mt-1 xl:gap-1.5 xl:pt-1" aria-label="일지 대상 이동">
              <Button type="button" variant="ghost" className="px-2 xl:min-h-8 xl:py-1" disabled={!previous || completing || deleting} aria-busy={Boolean(previous && navigationIntent === previous.id)} onClick={() => previous && void move(previous.id)}>{previous && navigationIntent === previous.id ? <LoaderCircle className="animate-spin" size={17} /> : <ChevronLeft size={17} />}이전</Button>
              <span className="text-center text-sm font-semibold tabular-nums text-text-secondary">{position + 1} / {rosterEntries.length}</span>
              <Button type="button" variant="ghost" className="px-2 xl:min-h-8 xl:py-1" disabled={!next || completing || deleting} aria-busy={Boolean(next && navigationIntent === next.id)} onClick={() => next && void move(next.id)}>다음{next && navigationIntent === next.id ? <LoaderCircle className="animate-spin" size={17} /> : <ChevronRight size={17} />}</Button>
            </nav>
          </header>

          <div className="order-2 space-y-2 xl:order-none" data-testid="journal-editor-status-region">
          {error ? <FormAlert>{error}</FormAlert> : null}
          {navigationRecovery ? (
            <div role="alert" className="rounded-xl border border-error/30 bg-error-soft p-3 text-sm text-text-primary">
              <p className="font-semibold">저장을 완료하지 못했습니다.</p>
              <p className="mt-0.5 text-text-secondary">입력 내용은 현재 화면에 유지됩니다.</p>
              {saveFailure ? (
                <p className="mt-1 text-xs text-text-secondary">
                  {journalFailureMessage(saveFailure.failureKind)} · {saveFailure.failureKind} · {saveFailure.diagnosticId}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" disabled={saveFailure?.failureKind === "VERSION_CONFLICT"} onClick={retryNavigation}>
                  {saveFailure?.failureKind === "VERSION_CONFLICT" ? "최신 상태 확인 필요" : "다시 시도"}
                </Button>
                {saveFailure ? <Button type="button" variant="ghost" onClick={() => void copyFailureDiagnostic()}><Clipboard size={16} />진단 정보 복사</Button> : null}
                <Button type="button" variant="ghost" onClick={continueEditing}>계속 작성</Button>
              </div>
            </div>
          ) : null}
          {entry.status === "COMPLETED" ? (
            <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm xl:py-1.5 ${nextIncomplete ? "border-success/20 bg-success-soft text-success" : "border-primary/20 bg-primary-soft text-primary"}`}>
              <strong className="inline-flex items-center gap-1.5"><Check size={17} />{nextIncomplete ? `${entry.dog.name} 일지 완료` : "오늘의 일지를 모두 작성했습니다."}</strong>
              {nextIncomplete ? <Button type="button" variant="secondary" className="ml-auto xl:min-h-9 xl:px-3 xl:py-1" onClick={() => void move(nextIncomplete.id)}>다음 미작성 · {nextIncomplete.dog.name}<ChevronRight size={17} /></Button> : null}
            </div>
          ) : null}
          </div>

          <div className="order-4 xl:absolute xl:right-3 xl:top-1 xl:z-10" data-testid="journal-editor-navigation-export">
            <div className="mb-2 xl:hidden">
              <Button type="button" variant="secondary" className="w-full" onClick={() => setPreviewOpen(true)}><Eye size={17} />미리보기</Button>
            </div>
            <JournalExportActions ready exporting={exporting} error={exportError} onExport={exportImage} navigationDesktop />
          </div>

          <DesktopJournalPreview viewModel={previewViewModel} />

          <div className="order-5 fixed inset-x-0 bottom-0 z-20 border-t border-border bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:left-64 xl:static xl:z-auto xl:rounded-2xl xl:border xl:bg-surface xl:p-1.5 xl:backdrop-blur-none" data-testid="journal-editor-final-actions">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 text-xs text-text-secondary"><SaveState state={saveState} failure={saveFailure} /></span>
            {saveFailure ? (
              <Button type="button" variant="ghost" className="min-h-11 px-2" onClick={() => void copyFailureDiagnostic()}>
                <Clipboard size={16} /><span className="hidden sm:inline">{diagnosticCopyState === "copied" ? "복사됨" : diagnosticCopyState === "error" ? "복사 실패" : "진단 정보 복사"}</span>
              </Button>
            ) : null}
            {onDelete ? (
              <Button type="button" aria-label="일지 삭제" variant="secondary" className="min-h-11 border-error/30 px-3 text-error hover:bg-error-soft" disabled={deleting} onClick={() => setDeleteOpen(true)}>
                <Trash2 size={17} /><span className="hidden sm:inline">일지 삭제</span>
              </Button>
            ) : null}
            <Button type="button" className="min-h-11 min-w-28" disabled={completing || deleting || saveState === "saving" || saveState === "slow"} onClick={() => void complete()}>{completing ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />}작성 완료</Button>
          </div>
          </div>
        </aside>
      </div>

      <Modal open={previewOpen} title="결과 미리보기" description={`${previewViewModel.dogName} · ${previewViewModel.displayDate}`} onClose={() => setPreviewOpen(false)} size="large" resetKey={entry.id}>
        <JournalExportActions ready exporting={exporting} error={exportError} onExport={exportImage} />
        <JournalReportPreview viewModel={previewViewModel} className="mx-auto max-w-[calc((100dvh-10rem)*0.75)] rounded-xl bg-[#fffcf8] shadow-[0_12px_36px_rgb(23_36_58_/_0.14)]" />
      </Modal>

      <Modal
        open={deleteOpen}
        title="일지 삭제"
        description={`${entry.dog.name}의 ${displayDate(entry.businessDate)} 일지를 삭제할까요? ${journalDeleteConfirmationDetail(entry.status)}`}
        onClose={() => { if (!deleting) setDeleteOpen(false); }}
        resetKey={`${entry.id}:${entry.version}`}
      >
        <ModalActions>
          <Button type="button" variant="secondary" disabled={deleting} onClick={() => setDeleteOpen(false)}>취소</Button>
          <Button type="button" data-modal-initial variant="danger" disabled={deleting} onClick={() => void remove()}>
            {deleting ? <LoaderCircle className="animate-spin" size={17} /> : <Trash2 size={17} />}{deleting ? "삭제 중..." : "삭제"}
          </Button>
        </ModalActions>
      </Modal>

    </section>
  );
}

function DesktopJournalPreview({ viewModel }: { viewModel: ReturnType<typeof buildJournalPreviewViewModel> }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const frameInset = 8;
      const width = Math.min(viewport.clientWidth - frameInset, (viewport.clientHeight - frameInset) * 0.75);
      setPreviewWidth(width > 0 ? width : null);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={viewportRef} className="journal-editor-preview-stage order-5 hidden min-h-0 items-center justify-center overflow-hidden xl:order-none xl:flex" aria-label={`${viewModel.dogName} 결과 미리보기`} data-testid="journal-editor-preview-viewport">
      <div className="journal-editor-preview-frame max-w-full rounded-2xl p-1" style={previewWidth ? { width: `${previewWidth + 8}px` } : undefined} data-testid="journal-editor-preview-frame">
        <JournalReportPreview viewModel={viewModel} className="w-full rounded-xl bg-[#fffcf8] shadow-[0_18px_50px_rgb(23_36_58_/_0.16)]" />
      </div>
    </div>
  );
}

function JournalExportActions({
  ready,
  exporting,
  error,
  onExport,
  navigationDesktop = false,
}: {
  ready: boolean;
  exporting: JournalExportFormat | null;
  error: string;
  onExport: (format: JournalExportFormat) => Promise<void>;
  navigationDesktop?: boolean;
}) {
  return (
    <div className={navigationDesktop ? "mb-3 rounded-xl border border-border bg-surface p-2.5 xl:mb-0 xl:border-0 xl:bg-transparent xl:p-0" : "mb-3 rounded-xl border border-border bg-surface p-2.5"} aria-label="일지 이미지 저장">
      <div className={`flex min-w-0 flex-wrap items-center justify-end ${navigationDesktop ? "gap-2 xl:gap-1" : "gap-2"}`}>
        <Button type="button" aria-label={exporting === "png" ? "이미지 만드는 중..." : "PNG 저장"} className={navigationDesktop ? "min-h-11 min-w-32 xl:min-w-20 xl:px-2 xl:text-xs" : "min-h-11 min-w-32"} disabled={!ready || exporting !== null} onClick={() => void onExport("png")}>
          {exporting === "png" ? <LoaderCircle className="animate-spin" size={17} /> : <Download size={17} />}
          <span className="xl:hidden">{exporting === "png" ? "이미지 만드는 중..." : "PNG 저장"}</span>
          <span className="hidden xl:inline">PNG</span>
        </Button>
        <Button type="button" aria-label={exporting === "jpg" ? "이미지 만드는 중..." : "JPG 저장"} variant="secondary" className={navigationDesktop ? "min-h-11 min-w-28 xl:min-w-20 xl:px-2 xl:text-xs" : "min-h-11 min-w-28"} disabled={!ready || exporting !== null} onClick={() => void onExport("jpg")}>
          {exporting === "jpg" ? <LoaderCircle className="animate-spin" size={17} /> : <Image size={17} />}
          <span className="xl:hidden">{exporting === "jpg" ? "이미지 만드는 중..." : "JPG 저장"}</span>
          <span className="hidden xl:inline">JPG</span>
        </Button>
      </div>
      {error ? <p role="alert" className={navigationDesktop ? "mt-2 text-sm text-error xl:absolute xl:right-0 xl:top-full xl:w-64 xl:rounded-xl xl:border xl:border-error/30 xl:bg-surface xl:p-2 xl:shadow-lg" : "mt-2 text-sm text-error"}>{error}</p> : null}
    </div>
  );
}

function SaveState({ state, failure }: { state: JournalSaveState; failure: JournalSaveFailureDiagnostic | null }) {
  if (state === "saving" || state === "slow") return <span className="inline-flex items-center gap-1"><LoaderCircle className="animate-spin" size={13} />저장 중...</span>;
  if (state === "error" || state === "timeout") return <span className="block truncate text-error">저장 실패{failure ? ` · ${failure.failureKind} · ${failure.diagnosticId}` : ""}</span>;
  if (state === "pending") return <span>저장 대기</span>;
  return <span>{state === "saved" ? "저장됨" : "변경 없음"}</span>;
}

function EditorSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <Card className="p-3.5 sm:p-4"><h2 className="text-base font-bold text-text-primary">{title}</h2>{description ? <p className="mt-0.5 text-xs text-text-muted">{description}</p> : null}<div className="mt-3">{children}</div></Card>;
}

const selectedChipClass = "border-primary bg-primary-soft text-primary shadow-[inset_0_0_0_1px_rgb(39_76_119_/_0.08)]";
const unselectedChipClass = "border-border-strong bg-surface text-text-secondary hover:border-primary/30 hover:bg-primary-subtle";

function ChipContent({ selected, label }: { selected: boolean; label: string }) {
  return <span className="inline-flex items-center justify-center gap-1.5">{selected ? <Check aria-hidden="true" size={14} strokeWidth={3} /> : null}{label}</span>;
}

function MultiChips<T extends string>({ options, values, onChange }: { options: Array<[T, string]>; values: T[]; onChange: (values: T[]) => void }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{options.map(([value,label]) => { const selected=values.includes(value); return <button key={value} type="button" aria-pressed={selected} onClick={() => onChange(selected ? values.filter((item) => item!==value) : [...values,value])} className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${selected ? selectedChipClass : unselectedChipClass}`}><ChipContent selected={selected} label={label} /></button>; })}</div>;
}

function SingleChips<T extends string>({ options, value, onChange, disabled=false }: { options: Array<[T,string]>; value: T|null; onChange:(value:T)=>void; disabled?:boolean }) {
  return <div className="grid grid-cols-2 gap-2">{options.map(([code,label]) => { const selected = value === code; return <button key={code} type="button" disabled={disabled} aria-pressed={selected} onClick={() => onChange(code)} className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${selected ? selectedChipClass : unselectedChipClass}`}><ChipContent selected={selected} label={label} /></button>; })}</div>;
}

function BinaryChoice({ label, value, onChange }: { label:string; value:boolean|null; onChange:(value:boolean)=>void }) {
  return <div><span className="mb-2 block text-sm font-semibold text-text-primary">{label}</span><div className="grid grid-cols-2 gap-2">{([true, false] as const).map((choice) => { const selected = value === choice; const text = choice ? "O" : "X"; return <button key={text} type="button" aria-pressed={selected} onClick={() => onChange(choice)} className={`min-h-11 rounded-xl border text-sm font-bold transition-colors ${selected ? selectedChipClass : unselectedChipClass}`}><ChipContent selected={selected} label={text} /></button>; })}</div></div>;
}

function LabeledSingle<T extends string>({ label, options, value, onChange }: { label:string; options:Array<[T,string]>; value:T|null; onChange:(value:T)=>void }) {
  return <div><span className="mb-2 block text-sm font-semibold text-text-primary">{label}</span><SingleChips options={options} value={value} onChange={onChange} /></div>;
}

function ActivitySection<T extends string>({ title, activity, evaluation, options, onActivity, onEvaluation }: { title:string; activity:string; evaluation:T|null; options:Array<[T,string]>; onActivity:(value:string)=>void; onEvaluation:(value:T)=>void }) {
  return <EditorSection title={title} description="활동명과 평가는 함께 입력하거나 둘 다 비워둘 수 있습니다."><Input aria-label={`${title} 활동명`} maxLength={80} value={activity} onChange={(event) => onActivity(event.target.value)} placeholder="활동명 직접 입력" className="min-h-11" /><div className="mt-3"><SingleChips options={options} value={evaluation} onChange={onEvaluation} /></div></EditorSection>;
}
