import { Check, ChevronDown, Laptop, LoaderCircle, Plus, Search, Trash2, Type } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { addJournalCustomFont, connectJournalSystemFonts, deleteJournalCustomFont, JOURNAL_CUSTOM_FONT_ACCEPT, journalCustomFontDisplayName, journalCustomFontPreviewFamily, reconnectJournalEntrySystemFont, resetJournalEntryTeacherCommentPresentation, selectJournalEntryCustomFont, selectJournalEntrySystemFont, selectJournalEntryTeacherCommentFontSize, useJournalEntryTeacherCommentPreference } from "./journalCustomFont";
import { JOURNAL_TEACHER_COMMENT_FONT_SIZES } from "./journalReportScene";

export function JournalTeacherCommentFontControl({ journalEntryId }: { journalEntryId: string }) {
  const preference = useJournalEntryTeacherCommentPreference(journalEntryId);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const activeSource = preference.activeSource ?? (preference.activeFontId ? "FILE" : "DEFAULT");
  const fontSize = preference.fontSize ?? 20;
  const availableSystemFonts = useMemo(() => preference.systemFonts ?? [], [preference.systemFonts]);
  const systemFontStatus = preference.systemFontStatus ?? "unsupported";
  const activeFile = preference.fonts.find((font) => font.id === preference.activeFontId) ?? null;
  const activeLabel = activeSource === "SYSTEM" ? preference.activeSystemFont?.fullName ?? "컴퓨터 글꼴" : activeFile ? journalCustomFontDisplayName(activeFile.displayName) : "기본 글꼴";
  const systemFonts = useMemo(() => { const value = search.trim().toLocaleLowerCase("ko"); return availableSystemFonts.filter((font) => !value || `${font.family} ${font.fullName} ${font.style}`.toLocaleLowerCase("ko").includes(value)).slice(0, 120); }, [availableSystemFonts, search]);
  const systemFontGroups = useMemo(() => systemFonts.reduce<Array<{ family: string; fonts: typeof systemFonts }>>((groups, font) => { const group = groups.find((candidate) => candidate.family === font.family); if (group) group.fonts.push(font); else groups.push({ family: font.family, fonts: [font] }); return groups; }, []), [systemFonts]);
  const reconnectRequired = activeSource === "SYSTEM" && systemFontStatus === "reconnect-required";

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", pointer); document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", keyboard); };
  }, [open]);

  const run = async (action: () => Promise<unknown>, close = false) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); if (close) setOpen(false); } catch (caught) { setError(caught instanceof Error ? caught.message : "글꼴을 처리하지 못했습니다."); } finally { setBusy(false); }
  };

  return <div ref={rootRef} className="relative z-20 mb-2" data-testid="journal-teacher-comment-font-control">
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-h-10 items-center gap-2">
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-text-secondary"><Type size={14} />글꼴</span>
        <button type="button" aria-expanded={open} aria-controls={menuId} aria-haspopup="listbox" disabled={busy || preference.status === "loading"} className="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border border-border-strong bg-surface px-3 text-left text-sm font-medium outline-none hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-primary/15 disabled:opacity-50" onClick={() => setOpen((value) => !value)}><span className="truncate" style={{ fontFamily: preference.activeFontFamily }}>{activeLabel}</span>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <ChevronDown className={open ? "rotate-180" : ""} size={16} />}</button>
      </div>
      <fieldset className="flex items-center gap-1" aria-label="선생님의 한마디 글자 크기"><legend className="sr-only">글자 크기</legend>{JOURNAL_TEACHER_COMMENT_FONT_SIZES.map((size) => <button key={size} type="button" aria-pressed={fontSize === size} className={`min-h-10 min-w-10 rounded-xl border px-2 text-xs font-bold tabular-nums ${fontSize === size ? "border-primary bg-primary text-white" : "border-border bg-surface text-text-secondary hover:bg-primary-soft"}`} onClick={() => void run(() => selectJournalEntryTeacherCommentFontSize(journalEntryId, size))}>{size}</button>)}</fieldset>
    </div>

    <input ref={inputRef} type="file" className="sr-only" accept={JOURNAL_CUSTOM_FONT_ACCEPT} aria-label="내 글꼴 파일 선택" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(() => addJournalCustomFont(file, journalEntryId)); }} />

    {open ? <div id={menuId} role="listbox" aria-label="선생님의 한마디 글꼴" className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[min(31rem,calc(100dvh-7rem))] overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-[0_18px_42px_rgb(23_36_58_/_0.18)] sm:left-auto sm:w-[25rem]">
      <FontOption label="기본 글꼴" selected={activeSource === "DEFAULT"} onClick={() => void run(() => selectJournalEntryCustomFont(journalEntryId, null), true)} />
      {preference.fonts.map((font) => { const selected = activeSource === "FILE" && font.id === preference.activeFontId; const label = journalCustomFontDisplayName(font.displayName); return <div key={font.id} className={`flex items-stretch rounded-xl ${selected ? "bg-primary-soft" : "hover:bg-surface-secondary"}`}><button type="button" role="option" aria-selected={selected} className="min-w-0 flex-1 rounded-l-xl px-3 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-primary" onClick={() => void run(() => selectJournalEntryCustomFont(journalEntryId, font.id), true)}><span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{label}</span>{selected ? <Check className="text-primary" size={16} /> : null}</span>{journalCustomFontPreviewFamily(font.id) ? <span className="mt-0.5 block truncate text-[13px] text-text-secondary" style={{ fontFamily: journalCustomFontPreviewFamily(font.id) }}>오늘도 즐거운 하루였어요.</span> : null}</button><button type="button" aria-label={`${label} 삭제`} className="flex min-h-11 w-11 items-center justify-center rounded-r-xl text-text-muted hover:bg-error-soft hover:text-error" onClick={() => void run(() => deleteJournalCustomFont(font.id))}><Trash2 size={16} /></button></div>; })}
      <div className="mt-2 grid gap-2 border-t border-border/70 pt-2 sm:grid-cols-2">
        <button type="button" className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-primary/35 bg-primary-subtle px-3 text-sm font-semibold text-primary hover:bg-primary-soft" onClick={() => inputRef.current?.click()}><Plus size={16} />글꼴 파일 추가</button>
        <button type="button" disabled={systemFontStatus === "unsupported" || systemFontStatus === "loading"} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-primary-soft disabled:opacity-50" onClick={() => void run(reconnectRequired ? () => reconnectJournalEntrySystemFont(journalEntryId) : connectJournalSystemFonts)}>{systemFontStatus === "loading" ? <LoaderCircle className="animate-spin" size={16} /> : <Laptop size={16} />}{reconnectRequired ? "컴퓨터 글꼴 다시 연결" : "컴퓨터 글꼴 보기"}</button>
      </div>
      {systemFontStatus === "unsupported" ? <Notice>이 브라우저에서는 컴퓨터 글꼴 연결을 지원하지 않습니다. 기본 글꼴, 글꼴 파일과 글자 크기는 그대로 사용할 수 있습니다.</Notice> : null}
      {systemFontStatus === "denied" ? <Notice>컴퓨터 글꼴 권한이 허용되지 않았습니다. 브라우저 권한을 확인한 뒤 다시 연결해 주세요.</Notice> : null}
      {systemFontStatus === "missing" ? <Notice>이전에 사용한 컴퓨터 글꼴을 찾을 수 없습니다. 목록에서 다른 글꼴을 선택하거나 기본 글꼴을 사용해 주세요.</Notice> : null}
      {systemFontStatus === "reconnect-required" ? <Notice>이전에 선택한 컴퓨터 글꼴을 사용하려면 다시 연결해 주세요.</Notice> : null}
      {(systemFontStatus === "ready" || systemFontStatus === "missing") && availableSystemFonts.length ? <div className="mt-2 border-t border-border/70 pt-2"><label className="flex min-h-10 items-center gap-2 rounded-xl border border-border bg-surface-secondary px-3"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="컴퓨터 글꼴 검색" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label><div className="mt-1 max-h-48 overflow-y-auto">{systemFontGroups.map((group) => <div key={group.family} role="group" aria-label={group.family}><p className="sticky top-0 bg-surface px-3 py-1 text-[11px] font-bold text-text-muted">{group.family}</p>{group.fonts.map((font) => <button key={font.postscriptName} type="button" role="option" aria-selected={activeSource === "SYSTEM" && preference.activeSystemFont?.postscriptName === font.postscriptName} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-primary-soft" onClick={() => void run(() => selectJournalEntrySystemFont(journalEntryId, font.postscriptName), true)}><span className="min-w-0"><strong className="block truncate text-sm">{font.fullName}</strong><span className="block truncate text-xs text-text-secondary">{font.style}</span></span>{preference.activeSystemFont?.postscriptName === font.postscriptName ? <Check className="text-primary" size={16} /> : null}</button>)}</div>)}</div></div> : null}
      {preference.hasEntryOverride ? <button type="button" className="mt-2 min-h-10 w-full rounded-xl text-xs font-semibold text-text-secondary hover:bg-primary-soft" onClick={() => void run(() => resetJournalEntryTeacherCommentPresentation(journalEntryId), true)}>기본 설정 사용</button> : null}
      <p className="mt-2 text-center text-[11px] text-text-muted">이 일지의 설정은 이 기기에만 저장됩니다 · 업로드되지 않습니다</p>
    </div> : null}
    {error ? <p role="alert" className="mt-1.5 text-xs font-medium leading-5 text-error">{error}</p> : null}
    {!error && preference.error ? <p aria-live="polite" className="mt-1.5 text-xs font-medium leading-5 text-text-secondary">{preference.error}</p> : null}
  </div>;
}

function FontOption({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) { return <button type="button" role="option" aria-selected={selected} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-primary-soft" onClick={onClick}><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-secondary"><Type size={16} /></span><span className="min-w-0 flex-1 text-sm font-semibold">{label}</span>{selected ? <Check className="text-primary" size={17} /> : null}</button>; }
function Notice({ children }: { children: string }) { return <p className="mt-2 rounded-xl bg-surface-secondary p-2 text-xs leading-5 text-text-secondary">{children}</p>; }
