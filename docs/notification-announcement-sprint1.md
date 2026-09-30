# Notification & Announcement Sprint 1

Candidate only. Base: `2550862ac06f398f1b2ba73f6f817bc49b0a7d6e`.

## Contract

`publish_announcement_v1` atomically persists announcement, ALL/USER targets, processed event, fixed recipient snapshot and inbox rows. ALL excludes author; explicit USER may include author. Only active profiles qualify. Request ID plus normalized payload prevents duplicate publication and rejects conflicting retries. No external HTTP or worker.

Five new tables: announcements, announcement_targets, notification_events, notifications, notification_capability_grants. Two explicit capabilities govern publish and receipt access independently. Exactly one active Operations owner is required for initial grants; subsequent role changes do not transfer grants. Retraction requires the original author and publish capability.

Self-only read, ACK and presentation RPCs preserve separate timestamps. ACK requires an available ACK-required announcement. Retraction retains receipts and revokes inbox visibility. Recipient snapshot never expands retroactively.

All five tables have RLS. Authenticated clients cannot directly mutate them. Event rows and announcement retry payloads are not client-readable. Own revoked notification receipts remain SELECTable so Realtime can deliver revocation; inbox/detail RPCs exclude revoked and expired notices. Targets and receipt statistics require management authority; publish alone does not grant receipt authority. SECURITY DEFINER functions fix search_path and restrict execution.

## App integration

Auth → NotificationProvider → existing module/data providers. One session survives route navigation and resets on account change. Bell appears in Finance, Operations, Journal and Module Gate. Feature defaults OFF; a future approved frontend release must set `VITE_ANNOUNCEMENTS_ENABLED=true` after DB rollout.

Realtime subscribes only to self recipient rows and refetches server counts, never increments locally. Focus, visibility, reconnect and visible 30-second polling recover missed updates. Receipt management refreshes on focus and every 30 seconds without subscribing to other users' receipts.

One summary per provider lifetime. Normal notices are presented once without marking read. Unacknowledged required notices may return in a fresh session; close is not ACK. Inbox pages contain 50 notices; summary selects up to 20. Plain text title/body limits are 100/4000. Expiry input uses Asia/Seoul. Ambiguous publish retries preserve request ID and payload during the current provider session, including composer close/reopen.

## Validation and boundaries

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`; run `python3 supabase/tests/notification_announcement_sprint1_qa.py` for isolated PostgreSQL contract tests. PostgreSQL QA uses synthetic profiles and a temporary Unix-socket-only cluster, not Production and not historical migration replay. React screenshots use actual components with a synthetic repository; no real employee data or business commands.

Production SQL, migration apply, db push and migration tracking are forbidden in this candidate. Existing 91 migrations remain unchanged. Future release order is DB first, then explicitly enabled frontend, under separate approval. Old app ignores additive tables. Disabled new frontend leaves existing UI intact.

Web Push, Service Worker, subscriptions, worker/cron/net, preferences, deliveries and automatic business alerts are excluded. Real Supabase websocket behavior requires later approved staging/Production acceptance. Mobile evidence is browser viewport simulation, not physical-device keyboard validation.
