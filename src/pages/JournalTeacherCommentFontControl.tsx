import { Check, ChevronDown, LoaderCircle, Plus, Trash2, Type } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  addJournalCustomFont,
  deleteJournalCustomFont,
  JOURNAL_CUSTOM_FONT_ACCEPT,
  journalCustomFontDisplayName,
  journalCustomFontPreviewFamily,
  selectJournalCustomFont,
  useJournalCustomFontPreference,
} from "./journalCustomFont";

export function JournalTeacherCommentFontControl() {
  const preference = useJournalCustomFontPreference();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = preference.fonts.find((font) => font.id === preference.activeFontId) ?? null;
  const activeLabel = active ? journalCustomFontDisplayName(active.displayName) : "기본 글꼴";

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const run = async (action: () => Promise<unknown>, closeAfter = false) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      if (closeAfter) setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "글꼴을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative z-20 mb-2" data-testid="journal-teacher-comment-font-control">
      <div className="flex min-h-10 items-center gap-2">
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-text-secondary"><Type size={14} aria-hidden="true" />글꼴</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          aria-haspopup="listbox"
          className="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl border border-border-strong bg-surface px-3 text-left text-sm font-medium text-text-primary outline-none transition-[border-color,box-shadow,background-color] hover:border-primary/30 hover:bg-primary-subtle focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || preference.status === "loading" || preference.status === "unsupported"}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="truncate" style={active ? { fontFamily: preference.activeFontFamily } : undefined}>{activeLabel}</span>
          {busy ? <LoaderCircle className="shrink-0 animate-spin" size={16} /> : <ChevronDown className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} size={16} />}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={JOURNAL_CUSTOM_FONT_ACCEPT}
        aria-label="내 글꼴 파일 선택"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void run(() => addJournalCustomFont(file));
        }}
      />

      {open ? (
        <div id={menuId} role="listbox" aria-label="선생님의 한마디 글꼴" className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[min(24rem,calc(100dvh-7rem))] overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-[0_18px_42px_rgb(23_36_58_/_0.18)] sm:left-auto sm:w-[22rem]">
          <button
            type="button"
            role="option"
            aria-selected={!active}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-primary-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => void run(() => selectJournalCustomFont(null), true)}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-text-secondary"><Type size={16} /></span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-text-primary">기본 글꼴</span>
            {!active ? <Check className="shrink-0 text-primary" size={17} /> : null}
          </button>

          {preference.fonts.length ? <div className="my-1 border-t border-border/70" /> : null}
          {preference.fonts.map((font) => {
            const selected = font.id === preference.activeFontId;
            const previewFamily = journalCustomFontPreviewFamily(font.id);
            const label = journalCustomFontDisplayName(font.displayName);
            return (
              <div key={font.id} className={`group flex items-stretch rounded-xl transition-colors ${selected ? "bg-primary-soft" : "hover:bg-surface-secondary"}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="min-w-0 flex-1 rounded-l-xl px-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  onClick={() => void run(() => selectJournalCustomFont(font.id), true)}
                >
                  <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-text-primary">{label}</span>{selected ? <Check className="shrink-0 text-primary" size={16} /> : null}</span>
                  {previewFamily ? <span className="mt-0.5 block truncate text-[13px] text-text-secondary" style={{ fontFamily: previewFamily }}>오늘도 즐거운 하루였어요.</span> : null}
                </button>
                <button
                  type="button"
                  aria-label={`${label} 삭제`}
                  className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-r-xl text-text-muted transition-colors hover:bg-error-soft hover:text-error focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-error"
                  disabled={busy}
                  onClick={() => void run(() => deleteJournalCustomFont(font.id))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}

          <div className="mt-1 border-t border-border/70 pt-2">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/35 bg-primary-subtle px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy || preference.status === "unsupported"}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? <LoaderCircle className="animate-spin" size={16} /> : <Plus size={16} />}내 글꼴 추가
            </button>
            <p className="mt-1.5 text-center text-[11px] leading-4 text-text-muted">이 기기에만 저장됩니다 · 최대 5개</p>
          </div>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-1.5 text-xs font-medium leading-5 text-error">{error}</p> : null}
      {!error && preference.error ? <p aria-live="polite" className="mt-1.5 text-xs font-medium leading-5 text-text-secondary">{preference.error}</p> : null}
    </div>
  );
}
