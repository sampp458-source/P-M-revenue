// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SignupPage } from './SignupPage';

const { signUp } = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ signUp }) }));
afterEach(() => { cleanup(); signUp.mockReset(); });

describe('Signup error presentation preserves validation and focus', () => {
  it('keeps the original field label and associates the nearby error without submitting', async () => {
    render(<MemoryRouter><SignupPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '계정 신청' }));
    const name = screen.getByRole('textbox', { name: '이름' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('이름을 입력해 주세요.');
    expect(name.getAttribute('aria-describedby')).toBe(alert.id);
    expect(name.closest('label')?.nextElementSibling).toBe(alert);
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(signUp).not.toHaveBeenCalled();
  });
  it('moves the same single error to the next invalid field and preserves its focus target', async () => {
    render(<MemoryRouter><SignupPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox', { name: '이름' }), { target: { value: '합성 검수' } });
    fireEvent.click(screen.getByRole('button', { name: '계정 신청' }));
    const phone = screen.getByRole('textbox', { name: /휴대폰 번호/ });
    const alert = screen.getByRole('alert');
    expect(phone.closest('label')?.nextElementSibling).toBe(alert);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(phone));
    expect(signUp).not.toHaveBeenCalled();
  });
});
