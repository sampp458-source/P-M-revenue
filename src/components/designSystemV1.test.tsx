// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Button, ConfirmModal, Input, Modal, Pagination, SearchBox, Select, StatusBadge, Textarea } from './ui';

afterEach(cleanup);
const wrap = (node: React.ReactNode) => <div className="pm-design-v1">{node}</div>;
describe('opt-in visual foundation preserves native contracts', () => {
  it('forwards button props and blocks disabled clicks', () => {
    const click = vi.fn();
    const { rerender } = render(wrap(<Button variant="danger" type="button" aria-label="삭제" onClick={click}>삭제</Button>));
    fireEvent.click(screen.getByRole('button'));
    expect(click).toHaveBeenCalledTimes(1);
    rerender(wrap(<Button disabled type="button" onClick={click}>처리 중</Button>));
    fireEvent.click(screen.getByRole('button'));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button')).toBeDisabled();
  });
  it('preserves input refs, validation and select/textarea change callbacks', () => {
    const ref = createRef<HTMLInputElement>();
    const input = vi.fn(), select = vi.fn(), text = vi.fn();
    render(wrap(<><Input ref={ref} aria-label="이름" value="벵거" aria-invalid required onChange={input}/><Select aria-label="종류" defaultValue="a" onChange={select}><option value="a">A</option><option value="b">B</option></Select><Textarea aria-label="메모" onChange={text}/></>));
    expect(ref.current).toBe(screen.getByRole('textbox', {name:'이름'}));
    expect(ref.current).toBeRequired();
    expect(ref.current).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(ref.current!, {target:{value:'긴 반려견 이름'}});
    fireEvent.change(screen.getByRole('combobox'), {target:{value:'b'}});
    fireEvent.change(screen.getByRole('textbox', {name:'메모'}), {target:{value:'메모'}});
    expect([input.mock.calls.length, select.mock.calls.length, text.mock.calls.length]).toEqual([1,1,1]);
  });
  it('retains search clear and input focus', async () => {
    const clear = vi.fn();
    render(wrap(<SearchBox value="벵거" readOnly onClear={clear}/>));
    fireEvent.click(screen.getByRole('button', {name:'검색어 초기화'}));
    expect(clear).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveFocus());
  });
  it('retains modal initial focus, Escape, backdrop and opener restore', async () => {
    const close = vi.fn();
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const { unmount } = render(wrap(<Modal open title="확인" onClose={close}><Input aria-label="입력"/></Modal>));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(close).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    fireEvent.keyDown(document, {key:'Escape'});
    expect(close).toHaveBeenCalledTimes(2);
    unmount(); expect(opener).toHaveFocus(); opener.remove();
  });
  it('retains processing confirmation lock and pagination boundaries', () => {
    const confirm = vi.fn(), close = vi.fn(), page = vi.fn();
    const { unmount } = render(wrap(<ConfirmModal open title="확인" description="설명" processing onConfirm={confirm} onClose={close}/>));
    fireEvent.click(screen.getByRole('button', {name:'처리 중...'}));
    fireEvent.keyDown(document, {key:'Escape'});
    expect(confirm).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    unmount();
    render(wrap(<Pagination page={1} totalPages={2} totalLabel="2건" onPageChange={page}/>));
    fireEvent.click(screen.getByRole('button', {name:'이전'})); expect(page).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name:'다음'})); expect(page).toHaveBeenCalledWith(2);
  });
  it('keeps status labels and semantic colors', () => {
    render(wrap(<><StatusBadge status="active"/><StatusBadge status="inactive"/></>));
    expect(screen.getByText('활성').className).toContain('text-success');
    expect(screen.getByText('비활성')).toBeVisible();
  });
  it('every CSS rule is scoped, with no global theme/animation or behavior selectors', () => {
    const css = readFileSync('src/design-system-v1.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      for (const selector of rule[1].split(',')) expect(selector.trim()).toMatch(/^\.pm-design-v1(?:\s|$)/);
    }
    expect(css).not.toMatch(/@(?:theme|keyframes)|pointer-events|display\s*:|visibility\s*:/);
  });
});
