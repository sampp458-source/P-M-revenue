// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchSelect } from "./SearchSelect";

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
}: {
  selectedIds?: string[];
  onChange?: (ids: string[]) => void;
  loadOptions?: (query: string) => Promise<readonly Item[]>;
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
    />,
  );

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("SearchSelect", () => {
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
    fireEvent.click(screen.getByRole("option", { name: /토리/ }));
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
});
