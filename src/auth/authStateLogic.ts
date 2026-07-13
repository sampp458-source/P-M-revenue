export function hasAuthIdentityChanged(previousUserId: string | null, nextUserId: string | null) {
  return previousUserId !== nextUserId;
}

export function shouldIgnoreInitialEmptySession(
  initialSessionResolved: boolean,
  nextUserId: string | null,
) {
  return !initialSessionResolved && nextUserId === null;
}

export function safeReturnTo(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  const pathname = value.split(/[?#]/, 1)[0];
  if (["/login", "/signup", "/find-account", "/forgot-password", "/reset-password"].includes(pathname)) {
    return "/dashboard";
  }
  return value;
}
