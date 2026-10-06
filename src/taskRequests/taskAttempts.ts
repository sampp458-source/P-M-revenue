import type { TaskCreate } from './taskRequestRepository';
// Memory only: retain an ambiguous result across modal close/type switches.
// Keys are account-scoped; task content is never written to browser storage.
export const pendingTaskCreates = new Map<string, TaskCreate>();
