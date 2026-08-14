import { LoaderCircle, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { SearchBox, cn } from "./ui";

const normalizeSearch = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s\-()]/g, "");

const readRecentIds = (storageKey?: string) => {
  if (!storageKey || typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const writeRecentIds = (storageKey: string | undefined, ids: string[]) => {
  if (!storageKey || typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
};

export interface SearchSelectViewportBounds {
  top: number;
  height: number;
  width: number;
}

export interface SearchSelectInputBounds {
  top: number;
  bottom: number;
}

export interface SearchSelectPanelLayout {
  placement: "above" | "below";
  maxHeight: number;
}

export function searchSelectPanelLayout(
  viewport: SearchSelectViewportBounds,
  input: SearchSelectInputBounds,
): SearchSelectPanelLayout | null {
  if (viewport.width >= 640) return null;
  const edge = 12;
  const gap = 8;
  const viewportBottom = viewport.top + viewport.height;
  const below = Math.max(0, viewportBottom - input.bottom - gap - edge);
  const above = Math.max(0, input.top - viewport.top - gap - edge);
  const placement = below >= Math.min(160, above) ? "below" : "above";
  return {
    placement,
    maxHeight: Math.floor(Math.min(320, placement === "below" ? below : above)),
  };
}

export function searchSelectInputNeedsScroll(
  viewport: SearchSelectViewportBounds,
  input: SearchSelectInputBounds,
) {
  const edge = 12;
  return input.top < viewport.top + edge || input.bottom > viewport.top + viewport.height - edge;
}

export interface SearchSelectRenderState {
  selected: boolean;
  recent: boolean;
}

export interface SearchSelectProps<T> {
  label: string;
  items?: readonly T[];
  selectedIds: readonly string[];
  onChange: (selectedIds: string[]) => void;
  getItemId: (item: T) => string;
  getSearchText: (item: T) => string;
  renderOption: (item: T, state: SearchSelectRenderState) => ReactNode;
  renderSelected?: (item: T) => ReactNode;
  loadOptions?: (query: string) => Promise<readonly T[]>;
  resolveRecentOptions?: (ids: string[]) => Promise<readonly T[]>;
  recentStorageKey?: string;
  placeholder?: string;
  emptyMessage?: string;
  noResultsMessage?: string;
  loadingMessage?: string;
  errorMessage?: string;
  disabled?: boolean;
  required?: boolean;
  multiple?: boolean;
  showAllOnEmpty?: boolean;
  debounceMs?: number;
  maxResults?: number;
  selectedPlacement?: "before" | "after";
}

export function SearchSelect<T>({
  label,
  items,
  selectedIds,
  onChange,
  getItemId,
  getSearchText,
  renderOption,
  renderSelected = (item) => getSearchText(item),
  loadOptions,
  resolveRecentOptions,
  recentStorageKey,
  placeholder = "검색",
  emptyMessage = "검색어를 입력해 주세요.",
  noResultsMessage = "검색 결과가 없습니다.",
  loadingMessage = "검색 중...",
  errorMessage = "검색 결과를 불러오지 못했습니다.",
  disabled = false,
  required = false,
  multiple = true,
  showAllOnEmpty = false,
  debounceMs = 220,
  maxResults = 8,
  selectedPlacement = "before",
}: SearchSelectProps<T>) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const emptyItemsRef = useRef<readonly T[]>([]);
  const getItemIdRef = useRef(getItemId);
  const getSearchTextRef = useRef(getSearchText);
  const loadOptionsRef = useRef(loadOptions);
  const resolveRecentOptionsRef = useRef(resolveRecentOptions);
  getItemIdRef.current = getItemId;
  getSearchTextRef.current = getSearchText;
  loadOptionsRef.current = loadOptions;
  resolveRecentOptionsRef.current = resolveRecentOptions;
  const availableItems = items ?? emptyItemsRef.current;
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [results, setResults] = useState<readonly T[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>(() =>
    readRecentIds(recentStorageKey),
  );
  const [panelLayout, setPanelLayout] = useState<SearchSelectPanelLayout | null>(null);

  const updatePanelLayout = useCallback(() => {
    const input = inputRef.current;
    const viewport = window.visualViewport;
    if (!input || !viewport) {
      setPanelLayout(null);
      return;
    }
    const rect = input.getBoundingClientRect();
    setPanelLayout(searchSelectPanelLayout(
      { top: viewport.offsetTop, height: viewport.height, width: viewport.width },
      { top: rect.top, bottom: rect.bottom },
    ));
  }, []);

  const keepInputVisible = useCallback(() => {
    const input = inputRef.current;
    const viewport = window.visualViewport;
    if (!input || !viewport || viewport.width >= 640) return;
    const rect = input.getBoundingClientRect();
    if (searchSelectInputNeedsScroll(
      { top: viewport.offsetTop, height: viewport.height, width: viewport.width },
      { top: rect.top, bottom: rect.bottom },
    )) {
      input.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setPanelLayout(null);
      return;
    }
    const viewport = window.visualViewport;
    const refresh = () => {
      keepInputVisible();
      window.requestAnimationFrame(updatePanelLayout);
    };
    refresh();
    viewport?.addEventListener("resize", refresh);
    viewport?.addEventListener("scroll", refresh);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      viewport?.removeEventListener("resize", refresh);
      viewport?.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [keepInputVisible, open, updatePanelLayout]);

  const itemById = useMemo(
    () =>
      new Map(
        availableItems.map((item) => [getItemIdRef.current(item), item]),
      ),
    [availableItems],
  );
  const selectedItems = selectedIds
    .map((selectedId) => itemById.get(selectedId))
    .filter((item): item is T => Boolean(item));

  useEffect(() => {
    setRecentIds(readRecentIds(recentStorageKey));
  }, [recentStorageKey]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedQuery(query),
      debounceMs,
    );
    return () => window.clearTimeout(timeout);
  }, [debounceMs, query]);

  useEffect(() => {
    let cancelled = false;
    const sequence = ++requestSequence.current;
    const normalizedQuery = normalizeSearch(debouncedQuery);

    const load = async () => {
      setLoading(true);
      setSearchError(false);
      try {
        let nextResults: readonly T[];
        if (normalizedQuery) {
          nextResults = loadOptionsRef.current
            ? await loadOptionsRef.current(debouncedQuery.trim())
            : availableItems.filter((item) =>
                normalizeSearch(getSearchTextRef.current(item)).includes(
                  normalizedQuery,
                ),
              );
        } else if (showAllOnEmpty) {
          const recentItems = recentIds
            .map((recentId) => itemById.get(recentId))
            .filter((item): item is T => Boolean(item));
          const recentItemIds = new Set(
            recentItems.map((item) => getItemIdRef.current(item)),
          );
          nextResults = [
            ...recentItems,
            ...availableItems.filter(
              (item) => !recentItemIds.has(getItemIdRef.current(item)),
            ),
          ];
        } else if (recentIds.length > 0) {
          nextResults = resolveRecentOptionsRef.current
            ? await resolveRecentOptionsRef.current(recentIds)
            : recentIds
                .map((recentId) => itemById.get(recentId))
                .filter((item): item is T => Boolean(item));
        } else nextResults = [];
        if (!cancelled && requestSequence.current === sequence) {
          setResults(nextResults.slice(0, maxResults));
          setActiveIndex(0);
        }
      } catch {
        if (!cancelled && requestSequence.current === sequence) {
          setResults([]);
          setSearchError(true);
        }
      } finally {
        if (!cancelled && requestSequence.current === sequence) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    debouncedQuery,
    availableItems,
    itemById,
    maxResults,
    recentIds,
    showAllOnEmpty,
  ]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  const remember = (itemId: string) => {
    const nextRecentIds = [
      itemId,
      ...recentIds.filter((recentId) => recentId !== itemId),
    ].slice(0, 6);
    setRecentIds(nextRecentIds);
    writeRecentIds(recentStorageKey, nextRecentIds);
  };

  const select = (item: T) => {
    const itemId = getItemId(item);
    const selected = selectedIds.includes(itemId);
    const nextSelectedIds = selected
      ? selectedIds.filter((selectedId) => selectedId !== itemId)
      : multiple
        ? [...selectedIds, itemId]
        : [itemId];
    onChange([...nextSelectedIds]);
    if (!selected) remember(itemId);
    setQuery("");
    if (!multiple) setOpen(false);
  };

  const remove = (itemId: string) => {
    onChange(selectedIds.filter((selectedId) => selectedId !== itemId));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!results.length) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (current) => (current + direction + results.length) % results.length,
      );
    } else if (event.key === "Enter" && open && results[activeIndex]) {
      event.preventDefault();
      select(results[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const showRecent = !query.trim() && results.length > 0;
  const selectedChips = selectedItems.length > 0 && (
    <div className="flex flex-wrap gap-2" aria-label={`${label} 선택됨`}>
      {selectedItems.map((item) => {
        const itemId = getItemId(item);
        return (
          <span
            key={itemId}
            className="inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border border-primary/10 bg-primary-soft py-1 pl-3 pr-1 text-xs font-semibold text-primary shadow-[0_2px_7px_rgb(39_76_119_/_0.08)]"
          >
            <span className="truncate">{renderSelected(item)}</span>
            <button
              type="button"
              aria-label={`${getSearchText(item)} 선택 해제`}
              disabled={disabled}
              onClick={() => remove(itemId)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary transition duration-150 ease-out hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X size={14} />
            </button>
          </span>
        );
      })}
    </div>
  );

  return (
    <fieldset ref={rootRef} className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium text-text-primary">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-error">
            *
          </span>
        )}
      </legend>

      {selectedPlacement === "before" && selectedChips}

      <div className="relative">
        <SearchBox
          inputRef={inputRef}
          value={query}
          aria-label={label}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && results[activeIndex]
              ? `${id}-option-${getItemId(results[activeIndex])}`
              : undefined
          }
          placeholder={placeholder}
          autoComplete="off"
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            window.requestAnimationFrame(() => {
              keepInputVisible();
              updatePanelLayout();
            });
          }}
          onBlur={() =>
            window.setTimeout(() => {
              if (!rootRef.current?.contains(document.activeElement)) {
                setOpen(false);
              }
            }, 0)
          }
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onClear={() => {
            setQuery("");
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />

        {open && (
          <div
            id={listboxId}
            role="listbox"
            aria-label={`${label} 검색 결과`}
            aria-multiselectable={multiple}
            data-viewport-placement={panelLayout?.placement ?? "fallback-below"}
            style={panelLayout ? { maxHeight: `${panelLayout.maxHeight}px` } : undefined}
            className={cn(
              "absolute left-0 right-0 z-40 max-h-[min(20rem,48dvh)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-1.5 shadow-[var(--pm-shadow-elevated)]",
              panelLayout?.placement === "above" ? "bottom-full mb-2" : "top-full mt-2",
            )}
          >
            {showRecent && !loading && !searchError && (
              <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                최근 선택
              </p>
            )}
            {loading ? (
              <p className="flex min-h-16 items-center justify-center gap-2 px-3 text-sm text-text-muted">
                <LoaderCircle className="animate-spin" size={16} />
                {loadingMessage}
              </p>
            ) : searchError ? (
              <p
                role="alert"
                className="flex min-h-16 items-center justify-center px-3 text-center text-sm text-error"
              >
                {errorMessage}
              </p>
            ) : results.length > 0 ? (
              results.map((item, index) => {
                const itemId = getItemId(item);
                const selected = selectedIds.includes(itemId);
                return (
                  <button
                    id={`${id}-option-${itemId}`}
                    key={itemId}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(item)}
                    className={cn(
                      "flex min-h-14 w-full items-center rounded-xl px-3 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      activeIndex === index && "bg-primary-subtle",
                    )}
                  >
                    {renderOption(item, { selected, recent: showRecent })}
                  </button>
                );
              })
            ) : (
              <p className="flex min-h-16 items-center justify-center px-3 text-center text-sm text-text-muted">
                {query.trim() ? noResultsMessage : emptyMessage}
              </p>
            )}
          </div>
        )}
      </div>
      {selectedPlacement === "after" && selectedChips}
    </fieldset>
  );
}
