export type AppModule = "finance" | "operations";
export type ModuleLocation = AppModule | "gate" | null;

export const moduleHome: Record<AppModule, string> = {
  finance: "/dashboard",
  operations: "/operations/today",
};

const financePaths = new Set([
  "/",
  "/dashboard",
  "/sales",
  "/sales/new",
  "/customers",
  "/categories",
  "/products",
  "/reports",
  "/settings",
  "/staff",
]);

const operationsPaths = new Set([
  "/operations",
  "/operations/today",
  "/operations/calendar",
  "/operations/schedules",
  "/operations/settings",
]);

function pathnameOf(value: string) {
  return value.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
}

function isInternalPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  );
}

export function getModuleFromPath(pathname: string): ModuleLocation {
  const normalized = pathnameOf(pathname);
  if (normalized === "/select-module") return "gate";
  if (normalized === "/operations" || normalized.startsWith("/operations/")) {
    return "operations";
  }
  if (
    financePaths.has(normalized) ||
    /^\/sales\/[^/]+\/edit$/.test(normalized)
  ) {
    return "finance";
  }
  return null;
}

export function isSafeModulePath(
  value: unknown,
  module: AppModule,
): value is string {
  if (!isInternalPath(value)) return false;
  const pathname = pathnameOf(value);
  if (module === "finance") {
    return financePaths.has(pathname) || /^\/sales\/[^/]+\/edit$/.test(pathname);
  }
  return operationsPaths.has(pathname);
}

export function safePendingReturnTo(value: unknown) {
  if (!isInternalPath(value)) return null;
  const module = getModuleFromPath(value);
  return module === "finance" || module === "operations" ? value : null;
}

export function resolveModuleDestination({
  target,
  pendingReturnTo,
  lastFinancePath,
  lastOperationsPath,
}: {
  target: AppModule;
  pendingReturnTo?: unknown;
  lastFinancePath?: unknown;
  lastOperationsPath?: unknown;
}) {
  if (isSafeModulePath(pendingReturnTo, target)) return pendingReturnTo;
  const lastPath = target === "finance" ? lastFinancePath : lastOperationsPath;
  return isSafeModulePath(lastPath, target) ? lastPath : moduleHome[target];
}

const key = (name: string, userId: string) => `pm-os:${name}:${userId}`;

function storageValue(
  storage: Storage | undefined,
  storageKey: string,
  value?: string | null,
) {
  if (!storage) return null;
  try {
    if (value === undefined) return storage.getItem(storageKey);
    if (value === null) storage.removeItem(storageKey);
    else storage.setItem(storageKey, value);
  } catch {
    // Storage restrictions must not prevent navigation or logout.
  }
  return null;
}

export function hasCompletedModuleGate(userId: string) {
  return (
    storageValue(
      typeof window === "undefined" ? undefined : window.sessionStorage,
      key("gate-complete", userId),
    ) === "true"
  );
}

export function markModuleGateComplete(userId: string) {
  storageValue(
    typeof window === "undefined" ? undefined : window.sessionStorage,
    key("gate-complete", userId),
    "true",
  );
}

export function readPendingReturnTo(userId: string) {
  return safePendingReturnTo(
    storageValue(
      typeof window === "undefined" ? undefined : window.sessionStorage,
      key("pending-return-to", userId),
    ),
  );
}

export function writePendingReturnTo(userId: string, value: unknown) {
  const safeValue = safePendingReturnTo(value);
  storageValue(
    typeof window === "undefined" ? undefined : window.sessionStorage,
    key("pending-return-to", userId),
    safeValue,
  );
}

export function readLastModulePath(userId: string, module: AppModule) {
  const value = storageValue(
    typeof window === "undefined" ? undefined : window.localStorage,
    key(`last-${module}-path`, userId),
  );
  return isSafeModulePath(value, module) ? value : null;
}

export function writeLastModulePath(
  userId: string,
  module: AppModule,
  value: string,
) {
  if (!isSafeModulePath(value, module)) return;
  storageValue(
    typeof window === "undefined" ? undefined : window.localStorage,
    key(`last-${module}-path`, userId),
    value,
  );
}

export function clearModuleSessionState(userId: string) {
  const storage =
    typeof window === "undefined" ? undefined : window.sessionStorage;
  storageValue(storage, key("gate-complete", userId), null);
  storageValue(storage, key("pending-return-to", userId), null);
}
