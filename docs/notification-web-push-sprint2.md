# Notification Web Push Sprint 2 — candidate architecture and release plan

## Status and actual audit (2026-09-30)

Candidate only. No Production write, extension enablement, cron/webhook creation, secrets, Edge deploy, Netlify change, commit or push.
HEAD / fetched origin/main / Netlify Published: `6ce63f2481e513ac0e658364a196971cac0319a7`.
Published deploy: `6abcab326b888b00071245d9`. Sprint 1, sent UX, hard delete and recipient inbox revision are present. The user has completed their actual Sprint 1 acceptance.
93 historical migrations are frozen byte-for-byte. New append-only candidate: `202609300002_notification_web_push_sprint2.sql`.
Production SELECT found PostgreSQL 17.6; pg_net 0.20.3 and pg_cron 1.6.4 available but NOT installed; supabase_vault 0.3.1 installed. No Push tables and no user notification INSERT trigger. No extensions were enabled. MANUAL_SQL_NO_DB_HISTORY_CONFIRMED remains the release convention.

## PWA

Existing `public/manifest.webmanifest`: standalone, start_url `/select-module`, scope `/`, Korean name/description, 192/512 icons. `index.html`: manifest link, 180 Apple touch icon and mobile web app metadata. No prior Service Worker, registration or cache layer.
Manifest has no explicit id: its current implicit start_url identity is retained; adding a different id could create a distinct installed app. Icons/manifest/start_url/theme and install behavior are unchanged. Netlify SPA fallback remains unchanged; the new real `/notification-sw.js` static file takes precedence. Explicit no-cache header supports worker updates. There is no fetch interception/offline caching.

## Architecture decision

| Area | Supabase Edge + queue (chosen) | Netlify function + queue |
|---|---|---|
| Existing authority | Same database as canonical notifications and authenticated recipients | Needs same Supabase worker RPCs and cross-provider credentials |
| Secrets | Edge-only VAPID/private service key; Vault wake credential | Additional Netlify function secret and DB credential distribution |
| Immediacy | pg_net async wake after commit | Same pg_net/webhook external wake required |
| Retry | durable DB queue, minute cron wake | Same queue plus Netlify scheduled function or DB cron |
| Runtime | Actual Deno 2.5.2 typecheck, bundle, encryption/decryption, VAPID verification and fake HTTP PASS | Node web-push is straightforward, but no benefit after Deno proof |
| Deployment | One new Edge function and two extensions, controlled separately | New server hosting path plus cross-provider operations |
| Future events | Any canonical notification INSERT | Equally possible, but no simpler |

Chosen: notifications INSERT -> transactional queue -> pg_net async wake -> secret-authenticated Edge worker -> standards Web Push. Retrying cron is independent of the publisher browser. Publish does NOT wait for Apple/Google/browser HTTP. Failed wake stores only a generic diagnostic; durable delivery remains available to retry. Queue writes roll back with notification publication.
Pinned `web-push@3.6.7`, types `3.6.4`, transitive integrity in `deno.lock`. Use the library only to generate encrypted request details, then native fetch with abort timeout and redirect rejection. Actual Supabase-hosted execution is a future release acceptance step, not claimed by local Deno verification.

## Subscription and identity contract

`push_subscriptions`: endpoint unique, many devices per profile, auth.uid owner, p256dh/auth, expiry, binding generation, created/updated/last_seen/revoked timestamps. No UA fingerprint is collected. No ordinary client table CRUD/SELECT, including other users' endpoints/keys. RLS enabled with no client policies. Only narrow register/disable RPCs exposed to authenticated users; register requires active profile/account. Disable is own-device only and remains usable during account deactivation cleanup.

Register takes no profile_id. Same endpoint and keys are idempotent. Rebind requires possession of exact endpoint AND both subscription keys; a different key pair is rejected. Rebind/re-enable changes binding_id and cancels pending/in-flight prior identity jobs. Worker validates notification recipient == current subscription profile AND original binding_id. This prevents an old recipient's queued job from being sent to the newly bound account. Endpoint/key material is a capability secret, never an enumerated user resource.

Logout attempts server revoke (bounded timeout) and browser unsubscribe. Server failure still attempts local unsubscribe. Cleanup remains active if the frontend feature flag is rolled back. Auth-state sign-out also clears local subscriptions; login reconciles existing subscriptions without requesting permission. Account changes invalidate pending enable/reconcile operations. An in-flight request already accepted by a browser push provider cannot be recalled; payload stays generic. If both network revoke and browser unsubscribe fail, no software can guarantee immediate remote invalidation: UI disable reports failure, logout is never trapped. Subsequent 404/410 revokes stale server records.

Provider allowlist: HTTPS Apple Web Push, Google FCM, Mozilla autopush and WNS; no credentials/ports/fragments, no redirect following. Unknown provider needs deliberate allowlist review. This is endpoint SSRF protection, not browser UA sniffing.

## Queue and worker

`notification_push_deliveries`: notification/subscription unique, FK CASCADE for deletion, captured binding_id, PENDING/PROCESSING/SENT/FAILED/GONE/CANCELLED, attempt_count, available_at, lease timestamps, unique claim token, sent timestamp, sanitized error state.
Atomic `FOR UPDATE SKIP LOCKED`, max 10 items, 120-second lease. Independent concurrent workers cannot claim the same live lease. Get verifies token, >20 seconds remaining, active account/subscription, expiry/revocation/identity and kill switch. Up to 10 parallel sends, each 8-second timeout. Finish uses token CAS; old worker cannot overwrite a new lease. Crash leases are retried. Max six attempts; exponential 60/120/240/... seconds, bounded 30–3600 seconds; numeric Retry-After respected within bounds. 2xx SENT, 404/410 GONE + subscription revoke, 429/5xx/network RETRY, other HTTP failures terminal FAILED. Exhausted crash lease terminalized. Worker returns only aggregate status counts.

Exactly-once external transport is **not** possible across “provider accepted, worker crashed before SENT”. The implementation proves no simultaneous live-lease duplicate claim/send; crash ambiguity can cause a retry. Stable Web Push topic and OS notification tag replace/collapse duplicate visible notices where supported; they are not an exactly-once guarantee. No distributed transaction with the push provider is claimed.

Retract/expiry suppresses pending and freshly claimed jobs at canonical read. Hard delete cascades delivery rows; stale wake/worker becomes no-op. A retract/delete racing after final validation with already in-flight HTTP may still show the generic OS notice; the opened app follows canonical data. No existing announcement/read/ACK/receipt/retract/hard-delete RPC is rewritten.

## Service worker, payload and UX

Push payload only version, notification UUID, typed link and link UUID. OS title is fixed `P&M OS`; Announcement body fixed `새 공지가 도착했습니다.`; future known pipeline categories use `새 알림이 도착했습니다.`. No business title/body, dogs, names, phone numbers, financial information or arbitrary URL is accepted. Malformed payloads/external URL properties rejected.

Push-only SW shows notifications, closes clicked notice, focuses an existing same-origin app or opens `/select-module?push_notification=<uuid>`. Existing window receives a typed message. Subscription-change cannot safely authenticate: it unsubscribes a new unbound subscription and asks open clients to reconcile. Closed-client replacement requires next app visit; no stale automatic account binding.

MVP deep link is **Notification Center**, not automatic detail/read. Typed context survives existing login redirection in session storage. This deliberately preserves current authenticated receipt/read/ACK commands and avoids marking something read merely by restoring a target across logout/account switch. Precise detail auto-open/receipt timing is a separate small UX decision. A different account cannot read the original recipient's data; normal inbox RPCs remain authoritative.

Settings are in received Notification Center for employee/publisher alike. Feature flag `VITE_WEB_PUSH_ENABLED=true` plus valid public key; default OFF. Supported/default, enabled, denied, unsupported and home-screen guidance states. No automatic permission request: only the enable button starts requestPermission synchronously. No UA/browser-name sniffing. Capability/secure-context/standalone detection; touch browser lacking Push capability receives home-screen guidance (not a claim that every such device will support Push when installed).

Foreground unread count synchronizes Badging API if available; errors ignored. No fabricated background badge count. Background badges optional/deferred because a new Push does not encode an authoritative total.

## Candidate validation and limits

Isolated PostgreSQL fixture uses the actual Sprint 1, hard delete and new candidate SQL, with bounded profiles/auth/membership stand-ins. Not a replay of the unrelated historical Hotel foundation. Tests include active/inactive/pending/missing, private grants, spoof surface absent, multi-device/idempotence/rebind, wrong keys/other disable, endpoint SSRF, fanout, duplicate claims, retries/leases/tokens, expiry/retract/delete, rollback and wake failure isolation. A real publish invokes the trigger and two Deno workers deliver encrypted HTTP exactly once to a local fake endpoint.
Deno test independently decrypts RFC 8291 ciphertext and verifies the VAPID JWT with Web Crypto, then exercises fake endpoint statuses. Node compatibility signature-verification quirks are not used as the proof.
Frontend tests exercise actual SW source, typed click routes, current-device permission UX, logout/account switches, failed registration cleanup and optional badge. Existing notification tests remain unchanged. React PNGs use real NotificationDialogs/PushSettings with a deterministic local adapter; they are not evidence of iPhone OS permission or lockscreen delivery.

## Production setup plan — NOT EXECUTED

1. Re-audit current HEAD/catalog, existing 93 migrations and candidate SHA; complete separate candidate review/approval. Old app is compatible with new DB because changes are additive and no existing RPC signature changes.
2. Apply exact approved migration manually as one transaction. Do not use db push or insert migration tracking rows. Postflight tables/grants/RLS/functions/triggers/old announcement definitions and data preservation; enabled must remain false.
3. In a separately authorized release, enable available pg_net and pg_cron. Vault already installed. Do not weaken RLS or grant clients worker RPCs.
4. Generate one VAPID key pair securely using pinned web-push generation (server tool). Never print private key into review logs. Store private key only as Edge `VAPID_PRIVATE_KEY`; public key Edge `VAPID_PUBLIC_KEY`, frontend `VITE_WEB_PUSH_PUBLIC_KEY`. Subject must be maintained mailto/HTTPS contact. Never VITE-private or database/public-table private key. Rotation: plan a fresh browser subscription for each device under the new public key; keep the old pair until existing subscriptions are retired. No silent key rotation promised.
5. Generate an independent >=32 random-byte wake secret. Edge `PUSH_WORKER_SECRET`; Vault `notification_push_worker_secret` with identical value. Vault `notification_push_worker_url` = exact project Edge endpoint. Existing built-in SUPABASE_URL/SERVICE_ROLE_KEY remain Edge-only. No browser service key or trusted secret.
6. Deploy `notification-push-dispatch` with its checked-in config/lock; `verify_jwt=false` is intentional only because handler requires its own secret, constant-length digest comparison, POST, ignores caller payload. Test anonymous/wrong-secret 401 before enabling. Do not expose arbitrary recipient/endpoint input.
7. Configure minute cron (separate approval): `SELECT cron.schedule('notification-push-retry','* * * * *','SELECT public.wake_notification_push_v1();');`. Trigger already calls wake after queue INSERT; pg_net performs HTTP after commit. Cron picks retryable/crash leases and catches missed wakes. Configure monitoring on generic wake_error, exhausted attempts and overdue PROCESSING leases.
8. Fast-forward approved app only after DB/Edge postflight, build with `VITE_WEB_PUSH_ENABLED=false` first if needed. Preserve existing `VITE_ANNOUNCEMENTS_ENABLED=true`. Verify Published SHA and existing Bell/popup/read/ACK/delete.
9. Enable backend singleton only after secret/auth test passes. Build the same approved app SHA with `VITE_WEB_PUSH_ENABLED=true` + public key, verify deployment SHA. No private key goes in Netlify build.
10. Follow approved own-account iPhone acceptance below; do not send to unrelated staff without authorization. A rollback turns backend enabled=false first and frontend flag OFF; retains additive schema/queue for diagnosis. No automatic schema rollback or domain data repair.

## iPhone / Android / desktop acceptance plan

1. Supported iPhone/iPad iOS 16.4+ Home Screen P&M OS, signed in to approved test recipient. Ordinary tab guidance first. Observe no permission prompt on launch.
2. Notification Center -> 휴대폰 알림 켜기 -> explicitly Allow OS prompt. Deny on separate approved test device to verify guidance. Record app/iOS/browser versions.
3. Read-only administrative check: exactly one current subscription for this endpoint/recipient, keys NOT copied into reports. Repeat enable/reload yields no duplicate; add second device yields second subscription.
4. An approved publisher creates an explicitly authorized test announcement to this recipient only. Verify notification + queue transaction and SENT for each device; no duplicate from simultaneous wake.
5. Background/close Home Screen app, lock iPhone. Verify fixed P&M OS/new-announcement content and no PII. Record real arrival delay (OS Focus/battery/network can delay).
6. Tap notification -> P&M OS foreground -> Notification Center. Open approved notice -> original read/ACK/receipt flow. Repeat logged-out tap -> login -> center; different account must not expose previous recipient notice.
7. Same account second device receives independently. Disable on one stops that endpoint only. Logout A / login B on shared device -> no further A deliveries; authorized B test goes to B. Never use unrelated staff as test targets.
8. Retract before worker claims suppresses send; hard delete removes pending queue. If already shown, OS notice may remain; opening follows canonical center. No promise of remote OS recall.
9. Verify 404/410/retry with isolated test endpoints, never manufacture vendor failures against real staff. Check cron retry and wake failure monitoring.
10. Desktop 1440/mobile 390, Bell/badge/center/popup/composer/sent/delete regression. Browser screenshots are simulation; actual iPhone lockscreen and installed-app behavior require operator evidence after release.

## Primary references

- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- https://webkit.org/blog/14112/badging-for-home-screen-web-apps/
- https://supabase.com/docs/guides/functions/dependencies
- https://supabase.com/docs/guides/database/webhooks
- https://supabase.com/docs/guides/functions/schedule-functions
- https://github.com/supabase/pg_net
- https://github.com/web-push-libs/web-push
