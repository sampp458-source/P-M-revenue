import "./web-push.css";
import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import { webPushClient, type PushState } from "./webPushClient";
export function PushSettings({ userId, client = webPushClient }: { userId: string; client?: typeof webPushClient }) {
  const [state, setState] = useState<PushState>("off");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try { await client.prepare(); const result = await client.status(); if (alive) { setState(result); setReady(true); } }
      catch { if (alive) setError("기기 알림 설정을 불러오지 못했습니다."); }
    })();
    return () => { alive = false; };
  }, [client]);
  const action = (enable: boolean) => {
    setBusy(true); setError("");
    // Permission request begins synchronously in this button's user gesture.
    const pending = enable ? client.enable(userId) : client.disable();
    void pending.catch(e => setError(e instanceof Error ? e.message : "다시 시도해 주세요."))
      .finally(async () => { try { setState(await client.status()); } catch { setError("기기 상태를 확인하지 못했습니다."); } finally { setBusy(false); } });
  };
  return <section className="pn-push-settings" aria-label="휴대폰 알림">
    <div className="pn-push-heading"><Bell size={18} aria-hidden="true" /><strong>휴대폰 알림</strong><span className="pn-secondary">이 기기</span></div>
    {state === "on" ? <><p><Check size={15} aria-hidden="true" /> 이 기기에서 알림 받는 중</p><button className="pn-secondary-button" disabled={busy} onClick={() => action(false)}>이 기기 알림 끄기</button></>
      : state === "denied" ? <p className="pn-secondary">알림이 차단되어 있습니다. 브라우저 또는 OS 설정에서 허용해 주세요.</p>
      : state === "unsupported" ? <p className="pn-secondary">이 기기에서는 휴대폰 알림이 지원되지 않습니다. 받은 알림은 여기에서 확인할 수 있어요.</p>
      : state === "install" ? <p className="pn-secondary">홈 화면에 추가한 P&M OS에서 알림을 켜주세요. 브라우저 공유 메뉴에서 ‘홈 화면에 추가’를 선택하세요.</p>
      : <><p className="pn-secondary">알림 꺼짐 · 앱을 닫아도 새 공지를 받을 수 있어요.</p><button className="pn-secondary-button" disabled={!ready || busy} onClick={() => action(true)}>휴대폰 알림 켜기</button></>}
    {error && <p role="alert" className="pn-error">{error}</p>}
  </section>;
}
