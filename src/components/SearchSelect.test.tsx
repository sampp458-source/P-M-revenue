// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SearchSelect,
  searchSelectInputNeedsScroll,
  searchSelectPanelLayout,
} from "./SearchSelect";

interface Item {
  id: string;
  name: string;
  detail: string;
}

const items: Item[] = [
  { id: "dog-1", name: "토리", detail: "김철수 · 5678" },
  { id: "dog-2", name: "초코", detail: "이보호 · 1234" },
];

const renderSearchSelect = ({
  selectedIds = [],
  onChange = vi.fn(),
  loadOptions,
  multiple = true,
  showAllOnEmpty = false,
  resultsPresentation = "popover",
  maxSelections,
  pinnedItemIds,
}: {
  selectedIds?: string[];
  onChange?: (ids: string[]) => void;
  loadOptions?: (query: string) => Promise<readonly Item[]>;
  multiple?: boolean;
  showAllOnEmpty?: boolean;
  resultsPresentation?: "popover" | "inline";
  maxSelections?: number;
  pinnedItemIds?: readonly string[];
} = {}) =>
  render(
    <SearchSelect
      label="반려견"
      items={items}
      selectedIds={selectedIds}
      onChange={onChange}
      getItemId={(item) => item.id}
      getSearchText={(item) => `${item.name} ${item.detail}`}
      renderOption={(item) => (
        <span>
          <strong>{item.name}</strong>
          <small>{item.detail}</small>
        </span>
      )}
      renderSelected={(item) => item.name}
      loadOptions={loadOptions}
      recentStorageKey="test-search-select-recent"
      debounceMs={0}
      multiple={multiple}
      showAllOnEmpty={showAllOnEmpty}
      resultsPresentation={resultsPresentation}
      labelAccessory={<span>선택 {selectedIds.length}마리</span>}
      maxSelections={maxSelections}
      maxSelectionsMessage="선택 한도에 도달했습니다."
      pinnedItemIds={pinnedItemIds}
    />,
  );

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("SearchSelect", () => {
  it("places mobile results inside the visible keyboard viewport", () => {
    expect(searchSelectPanelLayout(
      { top: 0, height: 420, width: 375 },
      { top: 330, bottom: 374 },
    )).toEqual({ placement: "above", maxHeight: 310 });
    expect(searchSelectPanelLayout(
      { top: 48, height: 500, width: 430 },
      { top: 96, bottom: 140 },
    )).toEqual({ placement: "below", maxHeight: 320 });
    expect(searchSelectPanelLayout(
      { top: 0, height: 700, width: 768 },
      { top: 330, bottom: 374 },
    )).toBeNull();
  });

  it("requests scrolling only when the input is outside the visible viewport", () => {
    const viewport = { top: 60, height: 360, width: 375 };
    expect(searchSelectInputNeedsScroll(viewport, { top: 80, bottom: 124 })).toBe(false);
    expect(searchSelectInputNeedsScroll(viewport, { top: 390, bottom: 434 })).toBe(true);
  });

  it("searches locally and selects a result with the keyboard", async () => {
    const onChange = vi.fn();
    renderSearchSelect({ onChange });
    const input = screen.getByRole("combobox", { name: "반려견" });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "초코" } });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /초코/ })).toBeTruthy(),
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(["dog-2"]);
  });

  it("keeps recent selections and presents them when search is empty", async () => {
    const first = renderSearchSelect();
    const input = screen.getByRole("combobox", { name: "반려견" });
    fireEvent.change(input, { target: { value: "토리" } });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /토리/ })).toBeTruthy(),
    );
    const option = screen.getByRole("option", { name: /토리/ });
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    first.unmount();

    renderSearchSelect();
    fireEvent.focus(screen.getByRole("combobox", { name: "반려견" }));
    await waitFor(() => expect(screen.getByText("최근 선택")).toBeTruthy());
    expect(screen.getByRole("option", { name: /토리/ })).toBeTruthy();
  });

  it("supports debounced asynchronous search and a loading state", async () => {
    let resolveSearch: (value: readonly Item[]) => void = () => undefined;
    const loadOptions = vi.fn(
      () =>
        new Promise<readonly Item[]>((resolve) => {
          resolveSearch = resolve;
        }),
    );
    renderSearchSelect({ loadOptions });
    const input = screen.getByRole("combobox", { name: "반려견" });

    fireEvent.change(input, { target: { value: "토" } });
    await waitFor(() => expect(loadOptions).toHaveBeenCalledWith("토"));
    expect(screen.getByText("검색 중...")).toBeTruthy();
    resolveSearch([items[0]]);

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /토리/ })).toBeTruthy(),
    );
  });

  it("closes results after a single selection", async () => {
    renderSearchSelect({ multiple: false });
    const input = screen.getByRole("combobox", { name: "반려견" });
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "토리" } });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /토리/ })).toBeTruthy(),
    );
    const option = screen.getByRole("option", { name: /토리/ });
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(input);
  });

  it("can expose every available option before typing", async () => {
    localStorage.setItem(
      "test-search-select-recent",
      JSON.stringify(["dog-1"]),
    );
    renderSearchSelect({ showAllOnEmpty: true });
    fireEvent.focus(screen.getByRole("combobox", { name: "반려견" }));

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /토리/ })).toBeTruthy(),
    );
    expect(screen.getByRole("option", { name: /초코/ })).toBeTruthy();
  });

  it("stays collapsed until focus and keeps pinned options ahead of recent items", async () => {
    localStorage.setItem("test-search-select-recent", JSON.stringify(["dog-1"]));
    renderSearchSelect({ showAllOnEmpty: true, pinnedItemIds: ["dog-2"] });
    const input = screen.getByRole("combobox", { name: "반려견" });

    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.focus(input);

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("초코"),
      expect.stringContaining("토리"),
    ]);
  });

  it("distinguishes the empty prompt from a no-result search", async () => {
    renderSearchSelect();
    const input = screen.getByRole("combobox", { name: "반려견" });
    fireEvent.focus(input);
    expect(screen.getByText("검색어를 입력해 주세요.")).toBeTruthy();

    fireEvent.change(input, { target: { value: "없는 이름" } });
    await waitFor(() =>
      expect(screen.getByText("검색 결과가 없습니다.")).toBeTruthy(),
    );
  });

  it("renders a bounded inline result panel with complete fixed-height options", async () => {
    renderSearchSelect({ showAllOnEmpty: true, resultsPresentation: "inline" });
    fireEvent.focus(screen.getByRole("combobox", { name: "반려견" }));

    const listbox = await screen.findByRole("listbox", { name: "반려견 검색 결과" });
    expect(listbox.className).toContain("relative");
    expect(listbox.className).toContain("overflow-hidden");
    expect(listbox.className).not.toContain("absolute");
    expect(listbox.querySelector(".max-h-\\[11\\.25rem\\]")?.className).toContain("overflow-y-auto");
    expect(screen.getByText("선택 0마리")).toBeTruthy();
    for (const option of screen.getAllByRole("option")) {
      expect(option.className).toContain("h-[3.75rem]");
    }
  });

  it("fails closed at the multi-selection limit while keeping selected items removable", async () => {
    const onChange = vi.fn();
    renderSearchSelect({ selectedIds: ["dog-1"], onChange, showAllOnEmpty: true, maxSelections: 1 });
    fireEvent.focus(screen.getByRole("combobox", { name: "반려견" }));

    const selected = await screen.findByRole("option", { name: /토리/ });
    const blocked = screen.getByRole("option", { name: /초코/ });
    expect(selected.getAttribute("aria-disabled")).toBe("false");
    expect(blocked.getAttribute("aria-disabled")).toBe("true");
    expect(blocked.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("선택 한도에 도달했습니다.");
    fireEvent.click(blocked);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /토리 .* 선택 해제/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
