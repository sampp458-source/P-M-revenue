import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clipboard, Download, Eye, GraduationCap, Image, LoaderCircle, PawPrint, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Card, FormAlert, Input, Modal, ModalActions, Textarea } from "../components/ui";
import { SearchSelect } from "../components/SearchSelect";
import {
  createJournalConflictBufferRecord,
  deleteJournalConflictBuffer,
  loadJournalConflictBuffer,
  saveJournalConflictBuffer,
  type JournalConflictBufferRecord,
} from "./journalConflictRecovery";
import {
  formatJournalExternalVersionConflictDiagnostic,
  JournalAutosaveQueue,
  JournalExternalVersionConflictError,
  type JournalSaveState,
} from "./journalAutosave";
import { completeJournalWithDeadline, formatJournalCompletionDiagnostic, JournalCompletionError } from "./journalCompletion";
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
import { JournalTeacherCommentFontControl } from "./JournalTeacherCommentFontControl";
import { reconnectActiveJournalSystemFont, useJournalCustomFontPreference } from "./journalCustomFont";
import { measureJournalTeacherCommentGeometry } from "./journalTeacherCommentGeometry";
import { buildJournalPreviewViewModel, journalEntryToDraft } from "./journalPreviewViewModel";
import {
  constrainJournalTeacherCommentInput,
  JOURNAL_TEACHER_COMMENT_MAX_LENGTH,
  journalTeacherCommentLength,
} from "./journalTextNormalization";
import { JOURNAL_BEST_FRIEND_MAX_TARGETS, JOURNAL_BEST_FRIEND_TEACHER_LABEL } from "./journalBestFriendPresentation";
import {
  completeJournalEntry,
  fetchJournalEntry,
  normalizedJournalBestFriendTargets,
  updateJournalEntryDraft,
  type JournalCondition,
  type JournalBestFriendTarget,
  type JournalDraft,
  type JournalFriendRelationship,
  type JournalMannersEvaluation,
  type JournalMeal,
  type JournalPhysicalEvaluation,
  type JournalRosterEntry,
  type JournalStoolCondition,
  type JournalTeacherRelationship,
} from "./journalRepository";

type BestFriendChoice = { id: string; label: string; target: JournalBestFriendTarget };
const BEST_FRIEND_PINNED_IDS = ["TEACHER"] as const;

export const JOURNAL_COMMENT_MAX_LENGTH = JOURNAL_TEACHER_COMMENT_MAX_LENGTH;
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
  const [teacherCommentInput, setTeacherCommentInput] = useState(() => journalEntryToDraft(rosterEntry).teacherComment);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<JournalSaveState>("idle");
  const [saveFailure, setSaveFailure] = useState<JournalSaveFailureDiagnostic | null>(null);
  const [completionFailure, setCompletionFailure] = useState<JournalCompletionError | null>(null);
  const [externalVersionFailure, setExternalVersionFailure] = useState<JournalExternalVersionConflictError | null>(null);
  const [conflictRecord, setConflictRecord] = useState<JournalConflictBufferRecord | null>(null);
  const [entryReloadGeneration, setEntryReloadGeneration] = useState(0);
  const [diagnosticCopyState, setDiagnosticCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState<JournalExportFormat | null>(null);
  const [exportError, setExportError] = useState("");
  const [reconnectingSystemFont, setReconnectingSystemFont] = useState(false);
  const customFont = useJournalCustomFontPreference();
  const versionRef = useRef(rosterEntry.version);
  const baseVersionRef = useRef(rosterEntry.version);
  const baseStatusRef = useRef(rosterEntry.status);
  const draftRef = useRef(journalEntryToDraft(rosterEntry));
  const baseDraftRef = useRef(journalEntryToDraft(rosterEntry));
  const conflictRecordRef = useRef<JournalConflictBufferRecord | null>(null);
  conflictRecordRef.current = conflictRecord;
  const teacherCommentInputRef = useRef(journalEntryToDraft(rosterEntry).teacherComment);
  const completionInputFreezeRef = useRef(false);
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
  const completionAttemptRef = useRef<{ entryId: string; expectedVersion: number; requestId: string } | null>(null);
  const completionLifecycleRef = useRef<AbortController | null>(null);
  const activeEntryIdRef = useRef(rosterEntry.id);
  activeEntryIdRef.current = rosterEntry.id;
  const teacherCommentCompositionRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setSaveFailure(null);
    setCompletionFailure(null);
    setExternalVersionFailure(null);
    completionAttemptRef.current = null;
    void fetchJournalEntry(rosterEntry.id)
      .then(async (loaded) => {
        const recovered = await loadJournalConflictBuffer(loaded.id).catch(() => null);
        if (cancelled) return;
        setEntry(loaded);
        const loadedDraft = journalEntryToDraft(loaded);
        const activeDraft = recovered?.localDraft ?? loadedDraft;
        draftRef.current = activeDraft;
        baseDraftRef.current = recovered?.baseSnapshot ?? loadedDraft;
        baseVersionRef.current = recovered?.baseVersion ?? loaded.version;
        baseStatusRef.current = recovered?.baseStatus ?? loaded.status;
        teacherCommentInputRef.current = activeDraft.teacherComment;
        setDraft(activeDraft);
        setTeacherCommentInput(activeDraft.teacherComment);
        setConflictRecord(recovered);
        versionRef.current = loaded.version;
        entryStatusRef.current = loaded.status;
        queueRef.current = new JournalAutosaveQueue(
          loaded.version,
          (snapshot, expectedVersion, requestId, signal) =>
            updateJournalEntryDraft(loaded.id, expectedVersion, snapshot, requestId, signal, entryStatusRef.current),
          (result) => {
            const persistedDraft = journalEntryToDraft(result);
            draftRef.current = persistedDraft;
            baseDraftRef.current = persistedDraft;
            baseVersionRef.current = result.version;
            baseStatusRef.current = result.status;
            versionRef.current = result.version;
            entryStatusRef.current = result.status;
            setEntry(result);
            onEntryUpdate(result);
            void deleteJournalConflictBuffer(result.id).catch(() => undefined);
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
              if (diagnostic?.failureKind === "VERSION_CONFLICT") {
                void (async () => {
                  const provisional = createJournalConflictBufferRecord({
                    entryId: loaded.id,
                    baseVersion: baseVersionRef.current,
                    latestServerVersion: baseVersionRef.current,
                    baseStatus: baseStatusRef.current,
                    localStatus: entryStatusRef.current,
                    latestServerStatus: baseStatusRef.current,
                    latestServerCaptured: false,
                    baseSnapshot: baseDraftRef.current,
                    localDraft: draftRef.current,
                    latestServerSnapshot: baseDraftRef.current,
                    timestamp: new Date().toISOString(),
                    classification: "TRUE_EXTERNAL_CONFLICT",
                  });
                  await saveJournalConflictBuffer(provisional).catch(() => undefined);
                  if (cancelled) return;
                  setConflictRecord(provisional);
                  try {
                    const latest = await fetchJournalEntry(loaded.id);
                    if (cancelled) return;
                    try {
                      queueRef.current?.acknowledgeExternalVersion(latest.version, {
                        entryId: loaded.id,
                        source: "server_refetch",
                        selfOriginated: false,
                      });
                    } catch (caught) {
                      if (caught instanceof JournalExternalVersionConflictError) {
                        setExternalVersionFailure(caught);
                        setDiagnosticCopyState("idle");
                      }
                    }
                    const record = createJournalConflictBufferRecord({
                      ...provisional,
                      latestServerVersion: latest.version,
                      latestServerStatus: latest.status,
                      latestServerCaptured: true,
                      latestServerSnapshot: journalEntryToDraft(latest),
                      timestamp: new Date().toISOString(),
                    });
                    await saveJournalConflictBuffer(record).catch(() => undefined);
                    if (!cancelled) setConflictRecord(record);
                  } catch {
                    // The local draft is already durable. The server snapshot can be retried on the next explicit recovery action.
                  }
                })();
              }
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
      completionLifecycleRef.current?.abort();
      completionLifecycleRef.current = null;
      queueRef.current?.dispose();
      queueRef.current = null;
    };
  }, [entryReloadGeneration, onEntryUpdate, rosterEntry.id]);

  const position = rosterEntries.findIndex((item) => item.id === rosterEntry.id);
  const previous = position > 0 ? rosterEntries[position - 1] : null;
  const next = position >= 0 && position < rosterEntries.length - 1 ? rosterEntries[position + 1] : null;
  const nextIncomplete = useMemo(
    () => rosterEntries.find((item) => item.id !== entry.id && item.status !== "COMPLETED") ?? null,
    [entry.id, rosterEntries],
  );
  const friendOptionsForDay = rosterEntries.filter((item) => item.dog.id !== entry.dog.id);
  const bestFriendChoices = useMemo<BestFriendChoice[]>(() => [
    { id: "TEACHER", label: JOURNAL_BEST_FRIEND_TEACHER_LABEL, target: { type: "TEACHER", dogId: null } },
    ...friendOptionsForDay.map((item) => ({
      id: `DOG:${item.dog.id}`,
      label: item.dog.name,
      target: { type: "DOG" as const, dogId: item.dog.id },
    })),
  ], [friendOptionsForDay]);
  const selectedBestFriendTargets = normalizedJournalBestFriendTargets(draft);
  const selectedBestFriendIds = selectedBestFriendTargets.map((target) => target.type === "TEACHER" ? "TEACHER" : `DOG:${target.dogId}`);
  const previewViewModel = useMemo(() => buildJournalPreviewViewModel(entry, draft, rosterEntries), [draft, entry, rosterEntries]);
  const commentFontSize = customFont.fontSize ?? 20;
  const commentGeometry = useMemo(() => measureJournalTeacherCommentGeometry(draft.teacherComment, customFont.activeFontFamily, commentFontSize), [commentFontSize, customFont.activeFontFamily, draft.teacherComment]);
  const systemFontReconnectRequired = customFont.activeSource === "SYSTEM" && customFont.systemFontStatus !== "ready";
  const exportPresentationReady = commentGeometry.available && !commentGeometry.overflow && !systemFontReconnectRequired;

  const update = (change: (current: JournalDraft) => JournalDraft) => {
    if (actionInFlightRef.current || completionInputFreezeRef.current) return;
    setCompletionFailure(null);
    const current = draftRef.current;
    const nextDraft = change(current);
    if (nextDraft === current) return;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setError("");
    const activeConflict = conflictRecordRef.current;
    if (activeConflict) {
      const nextConflict = createJournalConflictBufferRecord({ ...activeConflict, localDraft: nextDraft, timestamp: new Date().toISOString() });
      conflictRecordRef.current = nextConflict;
      setConflictRecord(nextConflict);
      void saveJournalConflictBuffer(nextConflict).catch(() => undefined);
    } else {
      queueRef.current?.schedule(nextDraft);
    }
  };

  useEffect(() => {
    if (!teacherCommentCompositionRef.current) setTeacherCommentInput(draft.teacherComment);
  }, [draft.teacherComment]);

  const commitTeacherCommentInput = (value: string, force = false) => {
    const teacherComment = constrainJournalTeacherCommentInput(draftRef.current.teacherComment, value);
    teacherCommentInputRef.current = teacherComment;
    setTeacherCommentInput(teacherComment);
    if (force) {
      const current = draftRef.current;
      if (teacherComment === current.teacherComment) return;
      const nextDraft = { ...current, teacherComment };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      queueRef.current?.schedule(nextDraft);
      return;
    }
    update((current) => teacherComment === current.teacherComment ? current : { ...current, teacherComment });
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
    if (!saveFailure && !completionFailure && !externalVersionFailure) return;
    const text = externalVersionFailure
      ? formatJournalExternalVersionConflictDiagnostic(externalVersionFailure.diagnostic)
      : completionFailure
      ? formatJournalCompletionDiagnostic(completionFailure.diagnostic)
      : formatJournalFailureDiagnostic(getJournalFailureDiagnostic(saveFailure!.diagnosticId) ?? saveFailure!);
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

  const discardLocalConflict = async () => {
    const activeConflict = conflictRecordRef.current;
    if (!activeConflict) return;
    const confirmed = window.confirm("이 기기의 작성 내용을 버릴까요?\n\n현재 기기에 보존된 작성 내용이 삭제되고, 저장되어 있는 최신 내용을 불러옵니다. 이 작업은 되돌릴 수 없습니다.");
    if (!confirmed) return;
    await deleteJournalConflictBuffer(activeConflict.entryId);
    queueRef.current?.dispose();
    conflictRecordRef.current = null;
    setConflictRecord(null);
    setExternalVersionFailure(null);
    setSaveFailure(null);
    setError("");
    setEntryReloadGeneration((current) => current + 1);
  };

  const move = async (targetId: string) => {
    await navigateAfterSave(targetId, () => onNavigate(targetId));
  };

  const close = async () => {
    await navigateAfterSave("list", onClose);
  };

  const complete = async () => {
    if (actionInFlightRef.current || conflictRecordRef.current) return;
    completionInputFreezeRef.current = true;
    teacherCommentCompositionRef.current = false;
    commitTeacherCommentInput(teacherCommentInputRef.current, true);
    actionInFlightRef.current = true;
    setCompleting(true);
    setError("");
    setCompletionFailure(null);
    let completionLifecycle: AbortController | null = null;
    let completionServerResult: JournalRosterEntry | null = null;
    try {
      if (!(await flush())) return;
      const queue = queueRef.current;
      const expectedVersion = versionRef.current;
      if (!queue) throw new Error("JOURNAL_AUTOSAVE_QUEUE_UNAVAILABLE");
      const targetRevision = queue.getDraftRevision();
      const priorAttempt = completionAttemptRef.current;
      const attempt = priorAttempt?.entryId === entry.id && priorAttempt.expectedVersion === expectedVersion
        ? priorAttempt
        : { entryId: entry.id, expectedVersion, requestId: crypto.randomUUID() };
      completionAttemptRef.current = attempt;
      completionLifecycle = new AbortController();
      completionLifecycleRef.current = completionLifecycle;
      const completed = await completeJournalWithDeadline({
        entryId: entry.id,
        expectedVersion,
        requestId: attempt.requestId,
        targetRevision,
        lifecycleSignal: completionLifecycle.signal,
        queueSnapshot: () => queue.getDiagnosticSnapshot(),
        request: (requestId, signal) => completeJournalEntry(entry.id, expectedVersion, requestId, signal),
      });
      completionServerResult = completed;
      if (completionLifecycle.signal.aborted || activeEntryIdRef.current !== entry.id) return;
      queueRef.current?.acknowledgeExternalVersion(completed.version, {
        entryId: entry.id,
        source: "completion_response",
        selfOriginated: true,
      });
      completionAttemptRef.current = null;
      versionRef.current = completed.version;
      entryStatusRef.current = completed.status;
      setEntry(completed);
      onEntryUpdate(completed);
      setSaveState("saved");
      baseDraftRef.current = journalEntryToDraft(completed);
      baseVersionRef.current = completed.version;
      baseStatusRef.current = completed.status;
      void deleteJournalConflictBuffer(completed.id).catch(() => undefined);
    } catch (caught) {
      if (completionLifecycle?.signal.aborted || activeEntryIdRef.current !== entry.id) return;
      if (caught instanceof JournalCompletionError) {
        setCompletionFailure(caught);
        setDiagnosticCopyState("idle");
        setError(`${caught.message} · ${caught.diagnostic.diagnosticId}`);
      } else if (caught instanceof JournalExternalVersionConflictError) {
        const latest = completionServerResult;
        if (latest) {
          const record = createJournalConflictBufferRecord({
            entryId: entry.id,
            baseVersion: baseVersionRef.current,
            latestServerVersion: latest.version,
            baseStatus: baseStatusRef.current,
            localStatus: entryStatusRef.current,
            latestServerStatus: latest.status,
            latestServerCaptured: true,
            baseSnapshot: baseDraftRef.current,
            localDraft: draftRef.current,
            latestServerSnapshot: journalEntryToDraft(latest),
            timestamp: new Date().toISOString(),
            classification: "SELF_ORIGINATED_WITH_LOCAL_PENDING",
          });
          await saveJournalConflictBuffer(record).catch(() => undefined);
          setConflictRecord(record);
        }
        setExternalVersionFailure(caught);
        setDiagnosticCopyState("idle");
        setError(`작성 완료 응답과 아직 저장되지 않은 로컬 변경이 충돌했습니다. 현재 작성 내용은 이 화면에 보존되어 있습니다. · ${caught.diagnostic.diagnosticId}`);
      } else {
        setError(caught instanceof Error ? caught.message : "작성 완료 처리에 실패했습니다.");
      }
    } finally {
      if (completionLifecycleRef.current === completionLifecycle) completionLifecycleRef.current = null;
      if (!completionLifecycle?.signal.aborted && activeEntryIdRef.current === entry.id) {
        completionInputFreezeRef.current = false;
        setCompleting(false);
        actionInFlightRef.current = false;
      }
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
    } catch (caught) {
      setExportError(caught instanceof Error && caught.message === "JOURNAL_CUSTOM_FONT_NOT_READY"
        ? "선택한 폰트를 불러오지 못했습니다. 기본 폰트로 변경한 뒤 다시 시도해 주세요."
        : caught instanceof Error && caught.message === "JOURNAL_SYSTEM_FONT_RECONNECT_REQUIRED"
          ? "선택한 컴퓨터 글꼴을 다시 연결한 뒤 저장해 주세요."
          : caught instanceof Error && caught.message === "JOURNAL_TEACHER_COMMENT_OVERFLOW"
            ? "선생님의 한마디가 일지 영역을 넘습니다. 글꼴·크기 또는 내용을 조정해 주세요."
            : "이미지를 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      exportInFlightRef.current = false;
      setExporting(null);
    }
  };

  const reconnectSystemFont = async () => {
    if (reconnectingSystemFont) return;
    setReconnectingSystemFont(true);
    setExportError("");
    try {
      await reconnectActiveJournalSystemFont();
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : "컴퓨터 글꼴을 다시 연결하지 못했습니다.");
    } finally {
      setReconnectingSystemFont(false);
    }
  };

  if (loading) return <Card className="flex min-h-72 items-center justify-center"><LoaderCircle className="animate-spin text-primary" /></Card>;

  return (
    <section className="mx-auto max-w-[1600px] overflow-x-hidden pb-24 xl:h-[calc(100dvh-110px)] xl:pb-0" aria-label={`${entry.dog.name} 일지 편집기`}>
      <div className="flex min-h-0 flex-col gap-3 xl:grid xl:h-full xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,1fr)] xl:items-stretch xl:gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(480px,1fr)] 2xl:gap-5">
        <div className="journal-editor-form-scrollbar order-3 min-w-0 xl:order-none xl:h-full xl:overflow-y-auto xl:overscroll-contain xl:pb-8 xl:pr-1.5" data-testid="journal-editor-form-scroll">
          <fieldset disabled={completing || deleting} className="space-y-3 disabled:opacity-70 xl:grid xl:grid-cols-2 xl:gap-2 xl:space-y-0" data-testid="journal-editor-form-grid">
        <EditorSection title="컨디션" description="하나 이상 선택해 주세요." desktopWide>
          <MultiChips options={conditionOptions} values={draft.conditionCodes} desktopNoWrap onChange={(conditionCodes) => update((value) => ({ ...value, conditionCodes }))} />
        </EditorSection>

        <EditorSection title="배변" desktopWide>
          <div className="xl:grid xl:grid-cols-2 xl:items-start xl:gap-2">
          <BinaryChoice label="소변" value={draft.urination} onChange={(urination) => update((current) => ({ ...current, urination }))} />
          <div className="mt-3 xl:mt-0"><BinaryChoice label="대변" value={draft.defecation} onChange={(defecation) => update((current) => ({ ...current, defecation, stoolCondition: defecation ? current.stoolCondition : null }))} /></div>
          <div className="mt-3 xl:col-span-2 xl:mt-0">
            <span className="mb-2 block text-sm font-semibold text-text-primary xl:mb-1.5">대변 상태</span>
            <SingleChips options={stoolOptions} value={draft.stoolCondition} disabled={draft.defecation !== true} desktopFourColumns desktopNoWrap onChange={(stoolCondition) => update((current) => ({ ...current, stoolCondition }))} />
          </div>
          </div>
        </EditorSection>

        <EditorSection title="먹은 것" description="선택하지 않아도 됩니다." desktopWide>
          <MultiChips options={mealOptions} values={draft.mealCodes} desktopNoWrap onChange={(mealCodes) => update((value) => ({ ...value, mealCodes }))} />
        </EditorSection>

        <EditorSection title="관계" desktopWide>
          <div className="xl:grid xl:grid-cols-2 xl:gap-2">
            <LabeledSingle label="선생님과" options={teacherOptions} value={draft.teacherRelationship} desktopLastWide desktopNoWrap onChange={(teacherRelationship) => update((current) => ({ ...current, teacherRelationship }))} />
            <div className="mt-3 xl:mt-0"><LabeledSingle label="친구들과" options={friendOptions} value={draft.friendRelationship} desktopLastWide desktopNoWrap onChange={(friendRelationship) => update((current) => ({ ...current, friendRelationship }))} /></div>
          </div>
        </EditorSection>

        <EditorSection title="제일 친한 친구" description={`오늘 등원한 다른 반려견과 선생님 중 최대 ${JOURNAL_BEST_FRIEND_MAX_TARGETS}명을 선택할 수 있습니다.`} desktopWide>
          <SearchSelect
            label="제일 친한 친구 검색"
            labelAccessory={<span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary">{selectedBestFriendTargets.length}/{JOURNAL_BEST_FRIEND_MAX_TARGETS}</span>}
            items={bestFriendChoices}
            selectedIds={selectedBestFriendIds}
            onChange={(ids) => {
              if (ids.length > JOURNAL_BEST_FRIEND_MAX_TARGETS) {
                setError(`제일 친한 친구는 최대 ${JOURNAL_BEST_FRIEND_MAX_TARGETS}명까지 선택할 수 있습니다.`);
                return;
              }
              const choices = new Map(bestFriendChoices.map((choice) => [choice.id, choice.target]));
              update((current) => ({ ...current, bestFriendTargets: ids.flatMap((id) => choices.get(id) ?? []) }));
            }}
            getItemId={(item) => item.id}
            getSearchText={(item) => item.label}
            renderOption={(item) => <span className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-soft text-primary">{item.target.type === "TEACHER" ? <GraduationCap size={18} /> : <PawPrint size={18} />}</span><strong className="text-sm text-text-primary">{item.label}</strong></span>}
            renderSelected={(item) => item.label}
            placeholder="당일 등원 반려견 또는 선생님 검색"
            emptyMessage="이름을 검색하거나 목록에서 선택하세요."
            noResultsMessage="선택 가능한 대상이 없습니다."
            multiple
            showAllOnEmpty
            resultsPresentation="popover"
            pinnedItemIds={BEST_FRIEND_PINNED_IDS}
            maxSelections={JOURNAL_BEST_FRIEND_MAX_TARGETS}
            maxSelectionsMessage={`${JOURNAL_BEST_FRIEND_MAX_TARGETS}/${JOURNAL_BEST_FRIEND_MAX_TARGETS} · 추가하려면 선택을 해제해 주세요.`}
          />
        </EditorSection>

        <ActivitySection title="예절교육" activity={draft.mannersActivityName} evaluation={draft.mannersEvaluation} options={mannersOptions} onActivity={(mannersActivityName) => update((current) => ({ ...current, mannersActivityName }))} onEvaluation={(mannersEvaluation) => update((current) => ({ ...current, mannersEvaluation }))} />
        <ActivitySection title="체육" activity={draft.physicalActivityName} evaluation={draft.physicalEvaluation} options={physicalOptions} onActivity={(physicalActivityName) => update((current) => ({ ...current, physicalActivityName }))} onEvaluation={(physicalEvaluation) => update((current) => ({ ...current, physicalEvaluation }))} />

        <EditorSection title="선생님의 한마디" description="작성 완료를 위해 한마디를 입력해 주세요." desktopWide>
          <JournalTeacherCommentFontControl />
          <Textarea
            aria-label="선생님의 한마디"
            rows={6}
            value={teacherCommentInput}
            onCompositionStart={() => { teacherCommentCompositionRef.current = true; }}
            onCompositionEnd={(event) => {
              teacherCommentCompositionRef.current = false;
              teacherCommentInputRef.current = event.currentTarget.value;
              commitTeacherCommentInput(event.currentTarget.value);
            }}
            onChange={(event) => {
              teacherCommentInputRef.current = event.target.value;
              if (teacherCommentCompositionRef.current) setTeacherCommentInput(event.target.value);
              else commitTeacherCommentInput(event.target.value);
            }}
            placeholder="오늘 하루의 특별한 모습을 기록해 주세요."
            className="min-h-36 resize-y"
          />
          <p className="mt-2 text-right text-xs tabular-nums text-text-muted">{journalTeacherCommentLength(draft.teacherComment)} / {JOURNAL_COMMENT_MAX_LENGTH}</p>
          {!exportPresentationReady ? <div role="alert" className="mt-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-5 text-text-primary">{systemFontReconnectRequired ? <div className="flex flex-wrap items-center justify-between gap-2"><span>사용 중인 컴퓨터 글꼴을 다시 연결해야 이미지를 저장할 수 있습니다. 작성 내용 저장과 작성 완료는 계속 사용할 수 있습니다.</span><Button type="button" variant="secondary" className="min-h-10 shrink-0 px-3 text-xs" disabled={reconnectingSystemFont} onClick={() => void reconnectSystemFont()}>{reconnectingSystemFont ? <LoaderCircle className="animate-spin" size={15} /> : null}컴퓨터 글꼴 다시 연결</Button></div> : commentGeometry.overflow ? `현재 내용이 일지 영역을 ${Math.ceil(Math.max(0, -commentGeometry.bottomRemaining))}px 초과합니다.${commentGeometry.recommendedSize && commentGeometry.recommendedSize !== commentFontSize ? ` ${commentGeometry.recommendedSize}px로 바꾸거나 내용을 조정해 주세요.` : " 글꼴·크기 또는 내용을 조정해 주세요."} 작성 내용 저장과 작성 완료는 가능하지만 이미지 저장은 글꼴·크기 또는 내용을 조정한 뒤 사용할 수 있습니다.` : "현재 글꼴의 표시 영역을 확인할 수 없습니다. 작성 내용 저장과 작성 완료는 가능하지만 이미지 저장은 중단됩니다."}</div> : null}
        </EditorSection>
          </fieldset>
        </div>

        <aside className="journal-editor-control-panel contents xl:sticky xl:top-[78px] xl:grid xl:h-full xl:min-h-0 xl:grid-rows-[auto_auto_minmax(0,1fr)_auto] xl:gap-0.5 xl:overflow-hidden xl:rounded-2xl" aria-label={`${previewViewModel.dogName} 일지 작업 패널`} data-testid="journal-editor-control-panel">
          <header className="order-1 rounded-2xl border border-border bg-surface p-3 shadow-sm sm:p-4 xl:order-none xl:px-3 xl:py-0.5">
            <div className="flex min-h-11 items-center gap-3 xl:min-h-9 xl:gap-2.5 xl:pr-44">
              <button type="button" aria-busy={navigationIntent === "list"} disabled={completing || deleting} onClick={() => void close()} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-text-secondary hover:bg-primary-soft hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 xl:min-h-9 xl:py-1">{navigationIntent === "list" ? <LoaderCircle className="animate-spin" size={18} /> : <ArrowLeft size={18} />}목록</button>
              <div className="min-w-0 flex-1 border-l border-border pl-3">
                <h1 className="truncate text-lg font-bold text-text-primary sm:text-xl">{entry.dog.name}</h1>
                <p className="truncate text-xs text-text-secondary sm:text-sm">{displayDate(entry.businessDate)} · {entry.status === "COMPLETED" ? "완료" : entry.status === "IN_PROGRESS" ? "작성중" : "미작성"} · <EditorPersistenceStatus state={saveState} failure={saveFailure} completing={completing} completionFailure={completionFailure} externalVersionFailure={externalVersionFailure} /></p>
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
          {conflictRecord ? (
            <div role="alert" className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-text-primary">
              <p className="font-semibold">{conflictRecord.classification === "TRUE_EXTERNAL_CONFLICT" ? "다른 기기에서 이 일지가 변경되었습니다." : "완료 처리 중 입력된 내용이 별도로 보존되었습니다."}</p>
              <p className="mt-1 text-text-secondary">{conflictRecord.latestServerCaptured ? "현재 작성 내용과 서버 최신본을 모두 보존했습니다." : "현재 작성 내용은 이 기기에 보존했으며 서버 최신본을 다시 확인해야 합니다."} 자동 덮어쓰기는 중단되며, 서버 최신본으로 전환하기 전까지 현재 내용을 계속 확인할 수 있습니다.</p>
              <Button type="button" variant="ghost" className="mt-2 min-h-9 px-2 text-error" onClick={() => void discardLocalConflict()}>현재 작성 내용 버리고 저장된 내용 불러오기</Button>
            </div>
          ) : null}
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
            <JournalExportActions ready={exportPresentationReady} exporting={exporting} error={exportError} onExport={exportImage} navigationDesktop />
          </div>

          <DesktopJournalPreview viewModel={previewViewModel} teacherCommentFontFamily={customFont.activeFontFamily} teacherCommentFontSize={commentFontSize} />

          <div className="order-5 fixed inset-x-0 bottom-0 z-20 border-t border-border bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:left-64 xl:static xl:z-auto xl:rounded-2xl xl:border xl:bg-surface xl:p-1.5 xl:backdrop-blur-none" data-testid="journal-editor-final-actions">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 text-xs text-text-secondary"><EditorPersistenceStatus state={saveState} failure={saveFailure} completing={completing} completionFailure={completionFailure} externalVersionFailure={externalVersionFailure} /></span>
            {saveFailure || completionFailure || externalVersionFailure ? (
              <Button type="button" variant="ghost" className="min-h-11 px-2" onClick={() => void copyFailureDiagnostic()}>
                <Clipboard size={16} /><span className="hidden sm:inline">{diagnosticCopyState === "copied" ? "복사됨" : diagnosticCopyState === "error" ? "복사 실패" : "진단 정보 복사"}</span>
              </Button>
            ) : null}
            {onDelete ? (
              <Button type="button" aria-label="일지 삭제" variant="secondary" className="min-h-11 border-error/30 px-3 text-error hover:bg-error-soft" disabled={deleting} onClick={() => setDeleteOpen(true)}>
                <Trash2 size={17} /><span className="hidden sm:inline">일지 삭제</span>
              </Button>
            ) : null}
            <Button type="button" className="min-h-11 min-w-28" disabled={Boolean(conflictRecord) || completing || deleting || saveState === "saving" || saveState === "slow"} onClick={() => void complete()}>{completing ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />}작성 완료</Button>
          </div>
          </div>
        </aside>
      </div>

      <Modal open={previewOpen} title="결과 미리보기" description={`${previewViewModel.dogName} · ${previewViewModel.displayDate}`} onClose={() => setPreviewOpen(false)} size="large" resetKey={entry.id}>
        <JournalExportActions ready={exportPresentationReady} exporting={exporting} error={exportError} onExport={exportImage} />
        <JournalReportPreview viewModel={previewViewModel} teacherCommentFontFamily={customFont.activeFontFamily} teacherCommentFontSize={commentFontSize} className="mx-auto max-w-[calc((100dvh-10rem)*0.75)] rounded-xl bg-[#fffcf8] shadow-[0_12px_36px_rgb(23_36_58_/_0.14)]" />
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

function DesktopJournalPreview({ viewModel, teacherCommentFontFamily, teacherCommentFontSize }: { viewModel: ReturnType<typeof buildJournalPreviewViewModel>; teacherCommentFontFamily: string; teacherCommentFontSize: 18 | 20 | 22 | 24 }) {
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
        <JournalReportPreview viewModel={viewModel} teacherCommentFontFamily={teacherCommentFontFamily} teacherCommentFontSize={teacherCommentFontSize} className="w-full rounded-xl bg-[#fffcf8] shadow-[0_18px_50px_rgb(23_36_58_/_0.16)]" />
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

function EditorPersistenceStatus({
  state,
  failure,
  completing,
  completionFailure,
  externalVersionFailure,
}: {
  state: JournalSaveState;
  failure: JournalSaveFailureDiagnostic | null;
  completing: boolean;
  completionFailure: JournalCompletionError | null;
  externalVersionFailure: JournalExternalVersionConflictError | null;
}) {
  if (completing) return <span className="inline-flex items-center gap-1"><LoaderCircle className="animate-spin" size={13} />완료 처리 중...</span>;
  if (completionFailure) return <span className="text-error">{completionFailure.kind === "timeout" ? "완료 처리 시간 초과 · 다시 시도" : "완료 처리 실패 · 다시 시도"}</span>;
  if (externalVersionFailure) return <span className="text-error">저장 충돌 · 로컬 내용 보존됨</span>;
  return <SaveState state={state} failure={failure} />;
}

function EditorSection({ title, description, children, desktopWide = false }: { title: string; description?: string; children: ReactNode; desktopWide?: boolean }) {
  return <Card className={`min-w-0 p-3.5 sm:p-4 xl:p-2 ${desktopWide ? "xl:col-span-2" : ""}`}><h2 className="text-base font-bold text-text-primary">{title}</h2>{description ? <p className="mt-0.5 text-xs text-text-muted">{description}</p> : null}<div className="mt-3 xl:mt-1">{children}</div></Card>;
}

const selectedChipClass = "border-primary bg-primary-soft text-primary shadow-[inset_0_0_0_1px_rgb(39_76_119_/_0.08)]";
const unselectedChipClass = "border-border-strong bg-surface text-text-secondary hover:border-primary/30 hover:bg-primary-subtle";

function ChipContent({ selected, label }: { selected: boolean; label: string }) {
  return <span className="inline-flex items-center justify-center gap-1.5">{selected ? <Check aria-hidden="true" size={14} strokeWidth={3} /> : null}{label}</span>;
}

function MultiChips<T extends string>({ options, values, onChange, desktopNoWrap=false }: { options: Array<[T, string]>; values: T[]; onChange: (values: T[]) => void; desktopNoWrap?: boolean }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{options.map(([value,label]) => { const selected=values.includes(value); return <button key={value} type="button" aria-pressed={selected} onClick={() => onChange(selected ? values.filter((item) => item!==value) : [...values,value])} className={`min-h-11 break-keep rounded-xl border px-3 py-2 text-sm font-semibold transition-colors xl:min-h-10 xl:py-1.5 ${desktopNoWrap ? "xl:whitespace-nowrap" : ""} ${selected ? selectedChipClass : unselectedChipClass}`}><ChipContent selected={selected} label={label} /></button>; })}</div>;
}

function SingleChips<T extends string>({ options, value, onChange, disabled=false, desktopFourColumns=false, desktopLastWide=false, desktopNoWrap=false }: { options: Array<[T,string]>; value: T|null; onChange:(value:T)=>void; disabled?:boolean; desktopFourColumns?: boolean; desktopLastWide?: boolean; desktopNoWrap?: boolean }) {
  return <div className={`grid grid-cols-2 gap-2 ${desktopFourColumns ? "xl:grid-cols-4" : ""}`}>{options.map(([code,label], index) => { const selected = value === code; return <button key={code} type="button" disabled={disabled} aria-pressed={selected} onClick={() => onChange(code)} className={`min-h-11 break-keep rounded-xl border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 xl:min-h-10 xl:py-1.5 ${desktopLastWide && index === options.length - 1 ? "xl:col-span-2" : ""} ${desktopNoWrap ? "xl:whitespace-nowrap" : ""} ${selected ? selectedChipClass : unselectedChipClass}`}><ChipContent selected={selected} label={label} /></button>; })}</div>;
}

function BinaryChoice({ label, value, onChange }: { label:string; value:boolean|null; onChange:(value:boolean)=>void }) {
  return <div><span className="mb-2 block text-sm font-semibold text-text-primary xl:mb-1.5">{label}</span><div className="grid grid-cols-2 gap-2">{([true, false] as const).map((choice) => { const selected = value === choice; const text = choice ? "O" : "X"; return <button key={text} type="button" aria-pressed={selected} onClick={() => onChange(choice)} className={`min-h-11 rounded-xl border text-sm font-bold transition-colors xl:min-h-10 ${selected ? selectedChipClass : unselectedChipClass}`}><ChipContent selected={selected} label={text} /></button>; })}</div></div>;
}

function LabeledSingle<T extends string>({ label, options, value, onChange, desktopLastWide=false, desktopNoWrap=false }: { label:string; options:Array<[T,string]>; value:T|null; onChange:(value:T)=>void; desktopLastWide?: boolean; desktopNoWrap?: boolean }) {
  return <div><span className="mb-2 block text-sm font-semibold text-text-primary xl:mb-1.5">{label}</span><SingleChips options={options} value={value} desktopLastWide={desktopLastWide} desktopNoWrap={desktopNoWrap} onChange={onChange} /></div>;
}

function ActivitySection<T extends string>({ title, activity, evaluation, options, onActivity, onEvaluation }: { title:string; activity:string; evaluation:T|null; options:Array<[T,string]>; onActivity:(value:string)=>void; onEvaluation:(value:T)=>void }) {
  return <EditorSection title={title} description="활동명과 평가는 함께 입력하거나 둘 다 비워둘 수 있습니다."><Input aria-label={`${title} 활동명`} maxLength={80} value={activity} onChange={(event) => onActivity(event.target.value)} placeholder="활동명 직접 입력" className="min-h-11 xl:min-h-10" /><div className="mt-3 xl:mt-2"><SingleChips options={options} value={evaluation} onChange={onEvaluation} /></div></EditorSection>;
}
