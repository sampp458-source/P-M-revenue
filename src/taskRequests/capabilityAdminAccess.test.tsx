// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCapabilityAdminAccess } from './useCapabilityAdminAccess';
import { useTaskAccess } from './useTaskAccess';
import { CapabilityManagement } from './CapabilityManagement';
const state = vi.hoisted(() => ({
  profile: { id: 'owner', role: 'staff', isActive: true, accountStatus: 'active' },
  role: vi.fn(), directory: vi.fn(), setCapability: vi.fn(), access: vi.fn(), enabled: false,
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ profile: state.profile }) }));
vi.mock('../pages/operationsScheduleRepository', () => ({ fetchCurrentOperationRole: state.role }));
vi.mock('./taskRequestRepository', async original => ({
  ...await original<typeof import('./taskRequestRepository')>(),
  get taskUiEnabled() { return state.enabled; },
  taskRequestRepository: { directory: state.directory, setCapability: state.setCapability, access: state.access },
}));
function Screen() {
  const admin = useCapabilityAdminAccess();
  const runtime = useTaskAccess(state.profile.id);
  return <>{admin.owner && <CapabilityManagement />}{runtime.enabled && <><span>My Tasks runtime</span>{runtime.can_create && <span>Task composer runtime</span>}</>}</>;
}
beforeEach(() => {
  state.profile = { id: 'owner', role: 'staff', isActive: true, accountStatus: 'active' };
  state.enabled = false;
  state.role.mockResolvedValue('owner');
  state.access.mockResolvedValue({ enabled: true, can_create: true, owner: true });
  state.directory.mockResolvedValue([{ id: 'staff', name: '담당 직원', active: true, operation_active: true, capabilities: {} }]);
  state.setCapability.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('OFF owner without Finance admin can manage all three capabilities but no Task runtime', async () => {
  render(<Screen />);
  await screen.findByRole('heading', { name: '업무 기능 권한' });
  for (const label of ['공지 발행', '공지 확인현황 조회', '업무요청 발행']) expect(await screen.findByLabelText(label)).toBeTruthy();
  expect(state.directory).toHaveBeenCalledTimes(1);
  expect(state.access).not.toHaveBeenCalled();
  expect(screen.queryByText('My Tasks runtime')).toBeNull();
  expect(screen.queryByText('Task composer runtime')).toBeNull();
});
it.each(['manager', 'staff', null])('OFF non-owner %s never fetches capability directory', async role => {
  state.role.mockResolvedValue(role);
  render(<Screen />); await act(async () => {});
  expect(state.directory).not.toHaveBeenCalled();
  expect(screen.queryByText('업무 기능 권한')).toBeNull();
});
it('Finance admin alone grants no Operations capability administration', async () => {
  state.profile.role = 'admin'; state.role.mockResolvedValue('staff');
  render(<Screen />); await act(async () => {});
  expect(state.directory).not.toHaveBeenCalled();
});
it.each(['inactive', 'pending'])('profile %s prevents even membership lookup', async status => {
  state.profile.accountStatus = status;
  render(<Screen />); await act(async () => {});
  expect(state.role).not.toHaveBeenCalled(); expect(state.directory).not.toHaveBeenCalled();
});
it('disabled profile cannot administer', async () => {
  state.profile.isActive = false;
  render(<Screen />); await act(async () => {});
  expect(state.role).not.toHaveBeenCalled(); expect(state.directory).not.toHaveBeenCalled();
});
it('membership lookup error fails closed', async () => {
  state.role.mockRejectedValue(new Error('offline'));
  render(<Screen />); await act(async () => {});
  expect(state.directory).not.toHaveBeenCalled();
});
it('OFF local grant and revoke use existing versioned setter and refresh toggles', async () => {
  let active = false, version = 0;
  state.directory.mockImplementation(async () => [{ id: 'staff', name: '담당 직원', active: true, operation_active: true, capabilities: { TASK_REQUEST_CREATE: { active, version } } }]);
  state.setCapability.mockImplementation(async (_id, _cap, next) => { active = next; version++; });
  render(<Screen />);
  const box = await screen.findByLabelText('업무요청 발행');
  fireEvent.click(box);
  await waitFor(() => expect((box as HTMLInputElement).checked).toBe(true));
  fireEvent.click(box);
  await waitFor(() => expect((box as HTMLInputElement).checked).toBe(false));
  expect(state.setCapability.mock.calls.map(c => c.slice(0, 4))).toEqual([['staff', 'TASK_REQUEST_CREATE', true, 0], ['staff', 'TASK_REQUEST_CREATE', false, 1]]);
  expect(state.access).not.toHaveBeenCalled();
});
it.each([false, true])('ON create access follows explicit capability %s', async granted => {
  state.enabled = true; state.access.mockResolvedValue({ enabled: true, can_create: granted, owner: true });
  render(<Screen />); await screen.findByText('My Tasks runtime');
  expect(!!screen.queryByText('Task composer runtime')).toBe(granted);
});
it('pre-granted capability stays hidden OFF and governs next ON session unchanged', async () => {
  const first = render(<Screen />); await act(async () => {});
  expect(state.access).not.toHaveBeenCalled(); expect(screen.queryByText('Task composer runtime')).toBeNull();
  first.unmount(); state.enabled = true;
  render(<Screen />); await screen.findByText('Task composer runtime');
  expect(state.setCapability).not.toHaveBeenCalled();
});
it('identity switch masks old owner immediately and ignores late responses', async () => {
  let resolve!: (role: string) => void;
  state.role.mockImplementationOnce(() => new Promise<string>(r => { resolve = r; })).mockResolvedValue('staff');
  const ui = render(<Screen />);
  state.profile = { ...state.profile, id: 'other' }; ui.rerender(<Screen />);
  await act(async () => { resolve('owner'); });
  expect(state.directory).not.toHaveBeenCalled();
});
it('focus refresh removes revoked owner access', async () => {
  render(<Screen />); await screen.findByText('업무 기능 권한');
  state.role.mockResolvedValue('staff'); fireEvent.focus(window);
  await waitFor(() => expect(screen.queryByText('업무 기능 권한')).toBeNull());
});
