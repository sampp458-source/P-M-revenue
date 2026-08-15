import { ArrowLeft, Check, ChevronLeft, ChevronRight, Eye, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Card, FormAlert, Input, Modal, Textarea } from "../components/ui";
import { JournalAutosaveQueue, type JournalSaveState } from "./journalAutosave";
import { JournalReportPreview } from "./JournalReportTemplate";
import { buildJournalPreviewViewModel } from "./journalPreviewViewModel";
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
  const [previewOpen, setPreviewOpen] = useState(false);
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
  const previewViewModel = useMemo(() => buildJournalPreviewViewModel(entry, draft, rosterEntries), [draft, entry, rosterEntries]);

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
    <section className="mx-auto max-w-[1480px] overflow-x-hidden pb-24" aria-label={`${entry.dog.name} 일지 편집기`}>
      <div className="xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)] xl:items-start xl:gap-6 2xl:gap-8">
        <div className="min-w-0">
          <header className="mb-3 rounded-2xl border border-border bg-surface p-3 shadow-sm sm:p-4">
            <div className="flex min-h-11 items-center gap-3">
              <button type="button" onClick={() => void close()} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-text-secondary hover:bg-primary-soft hover:text-primary"><ArrowLeft size={18} />목록</button>
              <div className="min-w-0 flex-1 border-l border-border pl-3">
                <h1 className="truncate text-lg font-bold text-text-primary sm:text-xl">{entry.dog.name}</h1>
                <p className="truncate text-xs text-text-secondary sm:text-sm">{displayDate(entry.businessDate)} · {entry.status === "COMPLETED" ? "완료" : entry.status === "IN_PROGRESS" ? "작성중" : "미작성"} · <SaveState state={saveState} /></p>
              </div>
            </div>
            <nav className="mt-2 grid grid-cols-3 items-center gap-2 border-t border-border pt-2" aria-label="일지 대상 이동">
              <Button type="button" variant="ghost" className="px-2" disabled={!previous || saveState === "saving"} onClick={() => previous && void move(previous.id)}><ChevronLeft size={17} />이전</Button>
              <span className="text-center text-sm font-semibold tabular-nums text-text-secondary">{position + 1} / {rosterEntries.length}</span>
              <Button type="button" variant="ghost" className="px-2" disabled={!next || saveState === "saving"} onClick={() => next && void move(next.id)}>다음<ChevronRight size={17} /></Button>
            </nav>
          </header>

          {error ? <div className="mb-3"><FormAlert>{error}</FormAlert></div> : null}
          {entry.status === "COMPLETED" ? (
            <div className={`mb-3 flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm ${nextIncomplete ? "border-success/20 bg-success-soft text-success" : "border-primary/20 bg-primary-soft text-primary"}`}>
              <strong className="inline-flex items-center gap-1.5"><Check size={17} />{nextIncomplete ? `${entry.dog.name} 일지 완료` : "오늘의 일지를 모두 작성했습니다."}</strong>
              {nextIncomplete ? <Button type="button" variant="secondary" className="ml-auto" onClick={() => void move(nextIncomplete.id)}>다음 미작성 · {nextIncomplete.dog.name}<ChevronRight size={17} /></Button> : null}
            </div>
          ) : null}

          <div className="space-y-3">
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
          <Textarea aria-label="선생님의 한마디" rows={6} maxLength={JOURNAL_COMMENT_MAX_LENGTH} value={draft.teacherComment} onChange={(event) => update((current) => ({ ...current, teacherComment: event.target.value }))} placeholder="오늘 하루의 특별한 모습을 기록해 주세요." className="min-h-36 resize-y" />
          <p className="mt-2 text-right text-xs tabular-nums text-text-muted">{draft.teacherComment.length} / {JOURNAL_COMMENT_MAX_LENGTH}</p>
        </EditorSection>
          </div>
        </div>

        <aside className="sticky top-6 hidden min-w-0 xl:block" aria-label={`${previewViewModel.dogName} 결과 미리보기`}>
          <JournalReportPreview viewModel={previewViewModel} className="mx-auto max-w-[min(34rem,calc((100vh-3rem)*0.75))] rounded-2xl shadow-[0_18px_50px_rgb(23_36_58_/_0.16)]" />
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:left-64">
        <div className="mx-auto max-w-[1480px] xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)] xl:gap-6 2xl:gap-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 flex-1 text-xs text-text-secondary"><SaveState state={saveState} /></span>
            <Button type="button" variant="secondary" className="min-h-11 px-3 xl:hidden" onClick={() => setPreviewOpen(true)}><Eye size={17} />미리보기</Button>
            <Button type="button" className="min-h-11 min-w-32" disabled={completing || saveState === "saving"} onClick={() => void complete()}>{completing ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />}작성 완료</Button>
          </div>
        </div>
      </div>

      <Modal open={previewOpen} title="결과 미리보기" description={`${previewViewModel.dogName} · ${previewViewModel.displayDate}`} onClose={() => setPreviewOpen(false)} size="large" resetKey={entry.id}>
        <JournalReportPreview viewModel={previewViewModel} className="mx-auto max-w-[calc((100dvh-10rem)*0.75)] rounded-xl shadow-[0_12px_36px_rgb(23_36_58_/_0.14)]" />
      </Modal>
    </section>
  );
}

function SaveState({ state }: { state: JournalSaveState }) {
  if (state === "saving") return <span className="inline-flex items-center gap-1"><LoaderCircle className="animate-spin" size={13} />저장 중...</span>;
  if (state === "error") return <span className="text-error">저장 실패</span>;
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
