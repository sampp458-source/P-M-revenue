import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getHotelSingleRoomEligibility, type SingleRoomEligibility } from "./hotelOperationsRepository";

type Entry = { status: "loading" | "ready" | "error"; data?: SingleRoomEligibility };

// Component-local, snapshot-scoped read cache. Drag cancellation is not invalidation.
export function useHotelPreassignEligibility(snapshot: object, selectedDate: string, enabled: boolean, requests: { id: string; version: number }[]) {
  const cache = useMemo(() => {
    const entries = new Map<string, Entry>();
    const listeners = new Set<() => void>();
    let revision = 0;
    const notify = () => { revision += 1; listeners.forEach(listener => listener()); };
    const load = (key: string, id: string, retry = false) => {
      if (!enabled || (entries.has(key) && !(retry && entries.get(key)?.status === "error"))) return;
      entries.set(key, { status: "loading" });
      notify();
      // Keep this request/result across drag end and rapid retries. The server
      // command remains authoritative; a refreshed snapshot creates a new cache.
      (async () => getHotelSingleRoomEligibility(id, "preassign"))()
        .then(data => { entries.set(key, { status: "ready", data }); notify(); })
        .catch(() => { entries.set(key, { status: "error" }); notify(); });
    };
    return { snapshot, selectedDate, entries, load, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, revision: () => revision };
  }, [snapshot, selectedDate, enabled]);
  useSyncExternalStore(cache.subscribe, cache.revision, cache.revision);
  const requestKeys = JSON.stringify(requests.map(({ id, version }) => [id, version]));
  useEffect(() => {
    const current = JSON.parse(requestKeys) as [string, number][];
    current.forEach(([id, version]) => cache.load(`${id}:${version}:${selectedDate}`, id));
  }, [cache, requestKeys, selectedDate]);
  return {
    get: (id: string, version: number) => cache.entries.get(`${id}:${version}:${selectedDate}`),
    retry: (id: string, version: number) => cache.load(`${id}:${version}:${selectedDate}`, id, true),
  };
}
