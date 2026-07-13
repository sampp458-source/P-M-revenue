export function hasAuthIdentityChanged(previousUserId: string | null, nextUserId: string | null) {
  return previousUserId !== nextUserId;
}
