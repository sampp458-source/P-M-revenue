import { Check, ChevronLeft, ChevronRight, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Card, FormAlert, Input, Textarea } from "../components/ui";
import { JournalAutosaveQueue, type JournalSaveState } from "./journalAutosave";
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

const toDraft = (entry: JournalRosterEntry): JournalDraft => ({
  conditionCodes: entry.conditionCodes ?? [],
  urination: entry.urination ?? null,
  defecation: entry.defecation ?? null,
  stoolCondition: entry.stoolCondition ?? null,
  mealCodes: entry.mealCodes ?? [],
  teacherRelationship: entry.teacherRelationship ?? null,
  friendRelationship: entry.friendRelationship ?? null,
  bestFriendDogId: entry.bestFriendDogId ?? null,
  mannersActivityName: entry.mannersActivityName ?? "",
  mannersEvaluation: entry.mannersEvaluation ?? null,
  physicalActivityName: entry.physicalActivityName ?? "",
  physicalEvaluation: entry.physicalEvaluation ?? null,
  teacherComment: entry.teacherComment ?? "",
});

const displayDate = (date: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(`${date}T12:00:00+09:00`));

export function JournalEditor({
  entry: rosterEntry,
  rosterEntries,
  onEntryUpdate,
  onNavigate,
  onClose,
}: {
  entry: JournalRosterEntry;
  rosterEntries: JournalRosterEntry[];
  onEntryUpdate: (entry: JournalRosterEntry) => void;
  onNavigate: (entryId: string) => void;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState(rosterEntry);
  const [draft, setDraft] = useState<JournalDraft>(() => toDraft(rosterEntry));
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<JournalSaveState>("idle");
  const [error, setError] = useState("");
  const [completing, setCompleting] = useState(false);
  const versionRef = useRef(rosterEntry.version);
  const queueRef = useRef<JournalAutosaveQueue<JournalDraft, JournalRosterEntry> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchJournalEntry(rosterEntry.id)
      .then((loaded) => {
        if (cancelled) return;
        setEntry(loaded);
        setDraft(toDraft(loaded));
        versionRef.current = loaded.version;
        queueRef.current = new JournalAutosaveQueue(
          loaded.version,
          (snapshot, expectedVersion) => updateJournalEntryDraft(loaded.id, expectedVersion, snapshot),
          (result) => {
            versionRef.current = result.version;
            setEntry(result);
            onEntryUpdate(result);
          },
          setSaveState,
          JOURNAL_AUTOSAVE_DELAY,
        );
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "일지를 불러오지 못했습니다."))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      queueRef.current?.cancel();
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

  const update = (change: (current: JournalDraft) => JournalDraft) => {
    setDraft((current) => {
      const nextDraft = change(current);
      queueRef.current?.schedule(nextDraft);
      setError("");
      return nextDraft;
    });
  };

  const flush = async () => {
    try {
      await queueRef.current?.flush();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "일지를 저장하지 못했습니다.");
      return false;
    }
  };

  const move = async (targetId: string) => {
    if (await flush()) onNavigate(targetId);
  };

  const close = async () => {
    if (await flush()) onClose();
  };

  const complete = async () => {
    if (completing || !(await flush())) return;
    setCompleting(true);
    setError("");
    try {
      const completed = await completeJournalEntry(entry.id, versionRef.current);
      versionRef.current = completed.version;
      setEntry(completed);
      onEntryUpdate(completed);
      setSaveState("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "작성 완료 처리에 실패했습니다.");
    } finally {
      setCompleting(false);
    }
  };

  if (loading) return <Card className="flex min-h-72 items-center justify-center"><LoaderCircle className="animate-spin text-primary" /></Card>;

  return (
    <section className="mx-auto max-w-4xl overflow-x-hidden pb-24" aria-label={`${entry.dog.name} 일지 편집기`}>
      <header className="mb-5 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-primary">{displayDate(entry.businessDate)}</p>
            <h1 className="mt-1 truncate text-2xl font-bold text-text-primary">{entry.dog.name}</h1>
            <p className="mt-1 text-sm text-text-secondary">{entry.status === "COMPLETED" ? "완료" : entry.status === "IN_PROGRESS" ? "작성중" : "미작성"} · <SaveState state={saveState} /></p>
          </div>
          <button type="button" aria-label="일지 목록으로" onClick={() => void close()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary hover:bg-surface-secondary"><X size={19} /></button>
        </div>
        <div className="mt-4 grid grid-cols-3 items-center gap-2">
          <Button type="button" variant="secondary" disabled={!previous || saveState === "saving"} onClick={() => previous && void move(previous.id)}><ChevronLeft size={17} />이전</Button>
          <span className="text-center text-sm font-semibold tabular-nums text-text-secondary">{position + 1} / {rosterEntries.length}</span>
          <Button type="button" variant="secondary" disabled={!next || saveState === "saving"} onClick={() => next && void move(next.id)}>다음<ChevronRight size={17} /></Button>
        </div>
      </header>

      {error ? <div className="mb-4"><FormAlert>{error}</FormAlert></div> : null}
      {entry.status === "COMPLETED" ? (
        <div className="mb-4 rounded-2xl border border-success/20 bg-success-soft p-4 text-sm text-success">
          <strong className="flex items-center gap-2"><Check size={18} />{entry.dog.name} 일지 완료</strong>
          {nextIncomplete ? <Button type="button" className="mt-3" onClick={() => void move(nextIncomplete.id)}>{nextIncomplete.dog.name} 작성하기<ChevronRight size={17} /></Button> : <p className="mt-2">오늘의 일지를 모두 완료했습니다.</p>}
        </div>
      ) : null}

      <div className="space-y-4">
        <EditorSection title="컨디션" description="하나 이상 선택해 주세요.">
          <MultiChips options={conditionOptions} values={draft.conditionCodes} onChange={(conditionCodes) => update((value) => ({ ...value, conditionCodes }))} />
        </EditorSection>

        <EditorSection title="배변">
          <BinaryChoice label="소변" value={draft.urination} onChange={(urination) => update((current) => ({ ...current, urination }))} />
          <div className="mt-4"><BinaryChoice label="대변" value={draft.defecation} onChange={(defecation) => update((current) => ({ ...current, defecation, stoolCondition: defecation ? current.stoolCondition : null }))} /></div>
          <div className="mt-4">
            <span className="mb-2 block text-sm font-semibold text-text-primary">대변 상태</span>
            <SingleChips options={stoolOptions} value={draft.stoolCondition} disabled={draft.defecation !== true} onChange={(stoolCondition) => update((current) => ({ ...current, stoolCondition }))} />
          </div>
        </EditorSection>

        <EditorSection title="먹은 것" description="선택하지 않아도 됩니다.">
          <MultiChips options={mealOptions} values={draft.mealCodes} onChange={(mealCodes) => update((value) => ({ ...value, mealCodes }))} />
        </EditorSection>

        <EditorSection title="관계">
          <LabeledSingle label="선생님과" options={teacherOptions} value={draft.teacherRelationship} onChange={(teacherRelationship) => update((current) => ({ ...current, teacherRelationship }))} />
          <div className="mt-5"><LabeledSingle label="친구들과" options={friendOptions} value={draft.friendRelationship} onChange={(friendRelationship) => update((current) => ({ ...current, friendRelationship }))} /></div>
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
          <Textarea aria-label="선생님의 한마디" rows={7} maxLength={JOURNAL_COMMENT_MAX_LENGTH} value={draft.teacherComment} onChange={(event) => update((current) => ({ ...current, teacherComment: event.target.value }))} placeholder="오늘 하루의 특별한 모습을 기록해 주세요." className="min-h-40 resize-y" />
          <p className="mt-2 text-right text-xs tabular-nums text-text-muted">{draft.teacherComment.length} / {JOURNAL_COMMENT_MAX_LENGTH}</p>
        </EditorSection>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <span className="min-w-0 flex-1 text-xs text-text-secondary"><SaveState state={saveState} /></span>
          <Button type="button" className="min-h-11 min-w-32" disabled={completing || saveState === "saving"} onClick={() => void complete()}>{completing ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />}작성 완료</Button>
        </div>
      </div>
    </section>
  );
}

function SaveState({ state }: { state: JournalSaveState }) {
  if (state === "saving") return <span className="inline-flex items-center gap-1"><LoaderCircle className="animate-spin" size={13} />저장 중...</span>;
  if (state === "error") return <span className="text-error">저장 실패</span>;
  return <span>{state === "saved" ? "저장됨" : "변경 없음"}</span>;
}

function EditorSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <Card className="p-4 sm:p-5"><h2 className="text-base font-bold text-text-primary">{title}</h2>{description ? <p className="mt-1 text-xs text-text-muted">{description}</p> : null}<div className="mt-4">{children}</div></Card>;
}

function MultiChips<T extends string>({ options, values, onChange }: { options: Array<[T, string]>; values: T[]; onChange: (values: T[]) => void }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{options.map(([value,label]) => { const selected=values.includes(value); return <button key={value} type="button" aria-pressed={selected} onClick={() => onChange(selected ? values.filter((item) => item!==value) : [...values,value])} className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold ${selected?'border-primary bg-primary text-white':'border-border-strong bg-surface text-text-secondary hover:bg-primary-soft'}`}>{label}</button>; })}</div>;
}

function SingleChips<T extends string>({ options, value, onChange, disabled=false }: { options: Array<[T,string]>; value: T|null; onChange:(value:T)=>void; disabled?:boolean }) {
  return <div className="grid grid-cols-2 gap-2">{options.map(([code,label]) => <button key={code} type="button" disabled={disabled} aria-pressed={value===code} onClick={() => onChange(code)} className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${value===code?'border-primary bg-primary text-white':'border-border-strong bg-surface text-text-secondary hover:bg-primary-soft'}`}>{label}</button>)}</div>;
}

function BinaryChoice({ label, value, onChange }: { label:string; value:boolean|null; onChange:(value:boolean)=>void }) {
  return <div><span className="mb-2 block text-sm font-semibold text-text-primary">{label}</span><div className="grid grid-cols-2 gap-2"><button type="button" aria-pressed={value===true} onClick={() => onChange(true)} className={`min-h-11 rounded-xl border text-sm font-bold ${value===true?'border-primary bg-primary text-white':'border-border-strong'}`}>O</button><button type="button" aria-pressed={value===false} onClick={() => onChange(false)} className={`min-h-11 rounded-xl border text-sm font-bold ${value===false?'border-primary bg-primary text-white':'border-border-strong'}`}>X</button></div></div>;
}

function LabeledSingle<T extends string>({ label, options, value, onChange }: { label:string; options:Array<[T,string]>; value:T|null; onChange:(value:T)=>void }) {
  return <div><span className="mb-2 block text-sm font-semibold text-text-primary">{label}</span><SingleChips options={options} value={value} onChange={onChange} /></div>;
}

function ActivitySection<T extends string>({ title, activity, evaluation, options, onActivity, onEvaluation }: { title:string; activity:string; evaluation:T|null; options:Array<[T,string]>; onActivity:(value:string)=>void; onEvaluation:(value:T)=>void }) {
  return <EditorSection title={title} description="활동명과 평가는 함께 입력하거나 둘 다 비워둘 수 있습니다."><Input aria-label={`${title} 활동명`} maxLength={80} value={activity} onChange={(event) => onActivity(event.target.value)} placeholder="활동명 직접 입력" className="min-h-11" /><div className="mt-3"><SingleChips options={options} value={evaluation} onChange={onEvaluation} /></div></EditorSection>;
}
