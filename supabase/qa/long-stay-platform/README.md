# Long Stay Platform 2-session QA

Clean QA 전용이다. 각 세션은 `hotel_qa.assert_isolated_environment()`를 먼저 실행한다.

## 월 중복 / Version 경쟁

1. 승인된 owner와 활성 Customer/Dog로 pending Contract 한 건을 만든다.
2. Session A와 B가 같은 `contract_id`, `expected_contract_version`, `service_month`, Room을 사용한다.
3. 서로 다른 `request_id`로 `confirm_long_stay_month()`를 호출한다.
4. Session A는 호출 뒤 4초간 Transaction을 유지하고, 300ms 뒤 Session B를 시작한다.
5. 정확히 한 세션만 성공하고 다른 세션은 `40001` 또는 활성 월 unique의 `23505`여야 한다.
6. `40P01`은 0, 활성 Monthly Occupancy/Capacity/current Allocation은 각각 1이어야 한다.

Clean QA 실제 결과(2026-08-08): Session A 성공, Session B `40001`, deadlock 0.

## 추가 경쟁 Matrix

- 같은 Room 동시 확정: 한 건 성공, 다른 건 `23P01`.
- 마지막 Room Type/전체 Capacity 경쟁: 한 건 성공, 다른 건 `23514`.
- planned checkout vs 월 확정: Contract row 직렬화, stale 쪽 `40001`.
- checkout vs 월 확정: Contract → Stay 순서 직렬화, stale 쪽 `40001`.
- 외출 leave/return 경쟁: open leave unique와 Contract lock으로 한 상태만 성립.
- 같은 request replay 경쟁: 동일 payload는 한 mutation과 replay 한 건, 다른 payload는 `23505`.

모든 committed QA fixture는 고정 request ID/명시적 ID allowlist로 추적한다. Long Stay 행은 제거하고 생성된 Hotel 업무 객체는 archive한 뒤 활성 Fixture 0을 확인한다. Immutable Hotel Audit은 삭제하지 않는다.
