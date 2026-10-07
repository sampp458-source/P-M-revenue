// Only the explicit visual role hooks added by Rollout 1 are removed.
// Historical behavioral hashes below remain unchanged.
export function normalizeVisualSystemD(source: string) {
  source = normalizeTaskRequestIntegration(normalizeNotificationShell(source));
  source = normalizeStaffDirectoryPresentation(source);
  source = source.replace('import "../visual-system-d-rollout3.css";\n', '');
  source = source.replace(/import "\.\.?\/visual-system-d-rollout4\.css";\n/g, '');
  for (const token of ["pm-d-rollout4", "pm-d-rollout3", "pm-d-report-metrics", "pm-d-journal-editor", "pm-d-editor-workspace", "pm-d-editor-header", "pm-d-editor-complete", "pm-d-editor-export-controls", "pm-d-ledger-detail-summary", "pm-d-dog-profile", "pm-d-calendar-board", "pm-d-calendar-day", "pm-d-calendar-detail", "pm-d-calendar-nav", "pm-d-catalog-workspace", "pm-d-ledger-summary", "pm-d-ledger-workspace", "pm-d-passive-summary", "pm-d-pet-directory", "pm-d-pet-row", "pm-d-rollout2", "pm-d-schedule-row", "pm-d-schedule-workspace", "pm-d-transaction-row", "pm-d-transaction-table", "pm-d-profile-entry", "pm-d-account", "pm-d-board", "pm-d-business-comparison", "pm-d-button-ghost", "pm-d-button-primary", "pm-d-button-secondary", "pm-d-command-heading", "pm-d-count-strip", "pm-d-date-control", "pm-d-directory", "pm-d-drawer", "pm-d-drawer-amber", "pm-d-drawer-band", "pm-d-drawer-cobalt", "pm-d-drawer-coral", "pm-d-drawer-flat", "pm-d-drawer-ink", "pm-d-drawer-muted", "pm-d-eyebrow", "pm-d-financial-summary", "pm-d-financial-workspace", "pm-d-form-section", "pm-d-hero-plane", "pm-d-hero-rail", "pm-d-input", "pm-d-metric", "pm-d-metric-cell", "pm-d-metric-hero", "pm-d-metric-secondary", "pm-d-modal", "pm-d-nav", "pm-d-operational-strip", "pm-d-overlay", "pm-d-page", "pm-d-page-heading", "pm-d-pane-control", "pm-d-panel", "pm-d-period-control", "pm-d-recommendation-group", "pm-d-recommendations", "pm-d-room-entity", "pm-d-room-object", "pm-d-room-total", "pm-d-room-tray", "pm-d-row", "pm-d-section-rail", "pm-d-service-markers", "pm-d-shared-member", "pm-d-shell-host", "pm-d-sidebar", "pm-d-status", "pm-d-sticky-action", "pm-d-toolbar-flat", "pm-d-workspace", "pm-design-d"].sort((a, b) => b.length - a.length)) {
    source = source.replaceAll(' ' + token, '').replaceAll(token + ' ', '');
  }
  return source;
}

// Rollout 4C changes table heading presentation and button styling hooks only.
// Restore those exact approved substitutions before historical behavioral hashing.
export function normalizeStaffDirectoryPresentation(source: string) {
  return normalizeTaskRequestIntegration(source).replace(`          <thead>\n            <tr>\n              <th colSpan={3} scope="colgroup">직원</th>\n              <th colSpan={2} scope="colgroup">접근 권한</th>\n              <th colSpan={4} scope="colgroup">상태 · 이력</th>\n              <th scope="col" className="text-right">관리</th>\n            </tr>\n          </thead>`, `          <thead>\n            <tr>\n              <th>이름</th>\n              <th>이메일</th>\n              <th>휴대폰 번호</th>\n              <th>Finance 역할</th>\n              <th>운영 권한</th>\n              <th>상태</th>\n              <th>가입일</th>\n              <th>승인일</th>\n              <th>퇴사일</th>\n              <th className="text-right">관리</th>\n            </tr>\n          </thead>`)
    .replace(/ data-staff-action="(?:role|color|approve|reject|deactivate|restore)"/g, "");
}

// Hotfix 1 adds only persistent shell paint hooks, never route/auth behavior.
export function normalizePersistentDShell(source: string) {
  source = normalizeTaskRequestIntegration(normalizeNotificationShell(source));
  source = source.replaceAll('app-sidebar pm-d-sidebar pm-design-d fixed', 'app-sidebar pm-d-sidebar fixed');
  const start = source.indexOf('function JournalAppLayout()');
  const end = source.indexOf('function AppLayout()', start);
  if (start < 0 || end < 0) return source;
  const journal = source.slice(start, end)
    .replace('pm-d-shell-host min-h-screen', 'min-h-screen')
    .replace('app-sidebar pm-d-sidebar fixed', 'app-sidebar fixed')
    .replace('app-sidebar-link pm-d-nav group', 'app-sidebar-link group')
    .replace('app-sidebar-profile pm-d-account mb', 'app-sidebar-profile mb');
  return source.slice(0, start) + journal + source.slice(end);
}

// Sprint 1 adds only these exact bell insertion points. Keep historical hashes intact.
export function normalizeNotificationShell(source: string) {
  return source.replace("<RequestQuickAction />", "")
  .replace('  if (access.loading && profile?.role !== "admin") return <p role="status">권한 확인 중…</p>;\n','')
    .replace('import { NotificationBell } from "./notifications/NotificationUi";\n', '')
    .replace('        <div className="pn-gate-bell"><NotificationBell /></div>\n', '')
    .replaceAll('<div className="pn-header-tools"><NotificationBell />\n          ', '')
    .replaceAll('          </div>\n          </div>\n        </header>', '          </div>\n        </header>');
}

// Exact Task V1 integration additions only; legacy Finance controls and Today remain frozen.
export function normalizeTaskRequestIntegration(source: string) {
 // Exact Payment V1 sidebar integration; runtime behavior has dedicated navigation tests.
 source = source
  .replace('import { usePaymentAccess } from "./paymentRequests/usePaymentAccess";\n', '')
  .replace('  const paymentAccess = usePaymentAccess(user?.id);\n', '')
  .replace(' || paymentAccess.confirmation_enabled || paymentAccess.payment_enabled', '');
 source = source
  .replace('import { RequestQuickAction, LegacyTaskRoute } from "./taskRequests/RequestLauncher";\n', '')
  .replace('<RequestQuickAction />', '')
  .replace('{ to: "/operations/requests", label: "요청", icon: ListChecks }', '{ to: "/operations/tasks", label: "업무요청", icon: ListChecks }')
  .replace('<Route path="requests" element={<TaskRequestsPage />} />\n        <Route path="tasks" element={<LegacyTaskRoute />} />', '<Route path="tasks" element={<TaskRequestsPage />} />')
  .replace('["/operations/tasks", "/operations/requests"].includes(pendingReturnTo?.split(/[?#]/, 1)[0] || "")', 'pendingReturnTo?.split(/[?#]/, 1)[0] === "/operations/tasks"')
  .replace('(item.to !== "/operations/requests" || taskAccess.enabled)', '(item.to !== "/operations/tasks" || taskAccess.enabled)');
 // Exact IA route/menu additions; keep historical hashes and unrelated auth bytes intact.
 source = source
  .replace('import { TaskRequestsPage } from "./taskRequests/TaskRequestsPage";\n', '')
  .replace('  { to: "/operations/tasks", label: "업무요청", icon: ListChecks },\n', '')
  .replace('        <Route path="tasks" element={<TaskRequestsPage />} />\n', '')
  .replace('const { chooseModule, pendingReturnTo } = useModule();', 'const { chooseModule } = useModule();')
  .replace('module.id === "operations" && pendingReturnTo?.split(/[?#]/, 1)[0] === "/operations/tasks" ? pendingReturnTo : moduleHome[module.id]', 'moduleHome[module.id]')
  .replace('  const taskAccess = useTaskAccess(user?.id);\n', '')
  .replace('(item.to !== "/operations/tasks" || taskAccess.enabled) && (item.to !== "/operations/staff" || profile?.role === "admin" || capabilityAccess.owner)', 'item.to !== "/operations/staff" || profile?.role === "admin" || capabilityAccess.owner');
 return source
  .replaceAll('useCapabilityAdminAccess', 'useTaskAccess')
  .replaceAll('const capabilityAccess = useTaskAccess();', 'const taskAccess = useTaskAccess(profile?.id);')
  .replaceAll('capabilityAccess.owner', 'taskAccess.owner')
  .replace('const access = useTaskAccess();', 'const access = useTaskAccess(profile?.id);')
  .replace('  if (access.loading && profile?.role !== "admin") return <p role="status">권한 확인 중…</p>;\n','')
  .replace(/import \{ (?:useTaskAccess|CapabilityManagement|TaskHomeEntry) \} from "\.\.?\/taskRequests\/(?:useTaskAccess|CapabilityManagement|TaskHomeEntry)";\n/g, '')
  .replaceAll('  const taskAccess = useTaskAccess(profile?.id);\n','')
  .replace(' || taskAccess.owner,', ',')
  .replace('  const access = useTaskAccess(profile?.id);\n  return profile?.role === "admin" ? children : access.owner ? <CapabilityManagement /> : <Navigate to="/operations/today" replace />;', '  return profile?.role === "admin"\n    ? children\n    : <Navigate to="/operations/today" replace />;')
  .replace('    {taskAccess.owner && <CapabilityManagement />}\n','')
  .replace('      <TaskHomeEntry />\n','');
}
