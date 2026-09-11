import {useLayoutEffect, useState, type ReactNode, type SyntheticEvent} from 'react';
import {cn} from '../components/ui';

// Retain only the last rendered presentation, never convert it into another date's data.
export function HotelDateTransition({date, ready, error, onRetry, retryInFlight = false, children}: {
  date: string; ready: boolean; error?: string; onRetry: () => void; retryInFlight?: boolean; children: ReactNode;
}) {
  const [previous, setPrevious] = useState<{date: string; children: ReactNode} | null>(null);
  useLayoutEffect(() => {
    if (ready) setPrevious({date, children});
  }, [ready, date, children]);
  const blocked = !ready;
  const stop = (event: SyntheticEvent) => {
    if (blocked) { event.preventDefault(); event.stopPropagation(); }
  };
  return <section aria-label="호텔 날짜별 화면" aria-busy={blocked && (!error || retryInFlight)}>
    <div className="mb-2 flex min-h-6 flex-wrap items-center gap-2 text-xs text-text-secondary" role={error && !retryInFlight ? 'alert' : 'status'} aria-live="polite">
      {blocked ? <>
        <span>{retryInFlight ? `${date} 다시 불러오는 중…` : error || `${date} 불러오는 중…`}</span>
        {previous ? <span>{previous.date} 화면 유지 · 조작 잠금</span> : null}
        {error || retryInFlight ? <button type="button" disabled={retryInFlight} className="rounded underline focus-visible:ring-2 focus-visible:ring-primary" onClick={onRetry}>{retryInFlight ? '재시도 중…' : '다시 시도'}</button> : null}
      </> : null}
    </div>
    <div inert={blocked} onClickCapture={stop} onKeyDownCapture={stop} onPointerDownCapture={stop} onPointerUpCapture={stop} onDragStartCapture={stop} onDragOverCapture={stop} onDropCapture={stop} onSubmitCapture={stop}
      className={cn('transition-opacity duration-150 motion-reduce:transition-none', blocked && 'pointer-events-none select-none opacity-60')}
      data-displayed-date={ready ? date : previous?.date} data-testid="hotel-date-presentation">
      {ready ? children : previous?.children ?? <div className="rounded-2xl border border-border p-5 text-sm text-text-secondary">객실 현황을 준비하고 있습니다.</div>}
    </div>
  </section>;
}
