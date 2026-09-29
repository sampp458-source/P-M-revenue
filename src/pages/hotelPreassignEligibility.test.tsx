// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useHotelPreassignEligibility } from "./useHotelPreassignEligibility";
const read = vi.hoisted(() => vi.fn());
vi.mock("./hotelOperationsRepository", () => ({ getHotelSingleRoomEligibility: read }));
afterEach(() => { cleanup(); read.mockReset(); vi.useRealTimers(); });
const deferred = () => { let resolve!: (data: unknown) => void; let reject!: (error: Error) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const data = {stayId: "arrival", purpose: "preassign", rooms: [{roomId: "deluxe", eligible: true, recommended: true}]};
it.each([100, 500, 1500])("preloads before drag and retains a single request across three cancellations at %ims", async delay => {
  vi.useFakeTimers();
  read.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(data), delay)));
  const snapshot = {};
  const {result, rerender} = renderHook(({drag}) => useHotelPreassignEligibility(snapshot, "2026-09-29", true, [{id:"arrival",version:1}, ...(drag ? [{id:"arrival",version:1}] : [])]), {initialProps:{drag:false}});
  await act(async () => {});
  expect(read).toHaveBeenCalledTimes(1);
  expect(result.current.get("arrival",1)?.status).toBe("loading");
  for (let i=0;i<3;i++) { rerender({drag:true}); rerender({drag:false}); }
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(delay); });
  expect(result.current.get("arrival",1)?.data).toEqual(data);
  rerender({drag:true});
  expect(result.current.get("arrival",1)?.status).toBe("ready");
  expect(read).toHaveBeenCalledTimes(1);
});
it.each(["date", "version", "snapshot"])("does not reuse or publish old results after %s invalidation", async kind => {
  const first=deferred(), second=deferred(); read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const initial={snapshot:{},date:"2026-09-29",version:1};
  const {result,rerender}=renderHook(p=>useHotelPreassignEligibility(p.snapshot,p.date,true,[{id:"arrival",version:p.version}]),{initialProps:initial});
  await waitFor(()=>expect(read).toHaveBeenCalledTimes(1));
  const next={...initial,...(kind==='date'?{date:'2026-09-30'}:kind==='version'?{version:2}:{snapshot:{}})};
  rerender(next);
  await waitFor(()=>expect(read).toHaveBeenCalledTimes(2));
  await act(async()=>first.resolve(data));
  expect(result.current.get('arrival',next.version)?.status).toBe('loading');
  await act(async()=>second.resolve({...data,rooms:[]}));
  expect(result.current.get('arrival',next.version)?.data?.rooms).toEqual([]);
});
it('exposes an error, retries explicitly, and deduplicates repeated retry while in flight',async()=>{
  const retry=deferred();read.mockRejectedValueOnce(Error('offline')).mockReturnValueOnce(retry.promise);
  const snapshot={};const {result}=renderHook(()=>useHotelPreassignEligibility(snapshot,'2026-09-29',true,[{id:'arrival',version:1}]));
  await waitFor(()=>expect(result.current.get('arrival',1)?.status).toBe('error'));
  act(()=>{result.current.retry('arrival',1);result.current.retry('arrival',1);});
  await waitFor(()=>expect(read).toHaveBeenCalledTimes(2));
  await act(async()=>retry.resolve(data));expect(result.current.get('arrival',1)?.status).toBe('ready');
});
it('does not preload unrelated future reservations or read-only views',async()=>{
  const snapshot={};const {rerender}=renderHook(({enabled})=>useHotelPreassignEligibility(snapshot,'2026-09-29',enabled,enabled?[]:[{id:'arrival',version:1}]),{initialProps:{enabled:false}});
  await act(async()=>{});rerender({enabled:true});await act(async()=>{});expect(read).not.toHaveBeenCalled();
});
it('invalidates an already-ready result on snapshot refresh instead of using it indefinitely',async()=>{
  read.mockResolvedValueOnce(data);const next=deferred();read.mockReturnValueOnce(next.promise);
  const {result,rerender}=renderHook(({snapshot})=>useHotelPreassignEligibility(snapshot,'2026-09-29',true,[{id:'arrival',version:1}]),{initialProps:{snapshot:{}}});
  await waitFor(()=>expect(result.current.get('arrival',1)?.status).toBe('ready'));
  rerender({snapshot:{}});
  expect(result.current.get('arrival',1)?.data).toBeUndefined();
  await act(async()=>next.resolve({...data,rooms:[]}));
  expect(result.current.get('arrival',1)?.data?.rooms).toEqual([]);
});
