# Hotel Room Board 교차 유형 2세션 동시성 QA

이 계획은 격리된 Hotel QA 프로젝트에서만 실행한다. 운영 프로젝트에서는 Fixture를 생성하거나 아래 호출을 실행하지 않는다.

## 공통 준비

1. Hotel QA Bootstrap과 Seed를 적용한다.
2. 신규 Append Migration Postflight가 `HOTEL_ROOM_BOARD_CROSS_TYPE_READY`인지 확인한다.
3. Session A와 Session B에 서로 다른 SQL Editor 연결을 연다.
4. 두 세션 모두 `lock_timeout = '12s'`, `statement_timeout = '30s'`를 트랜잭션 로컬로 설정한다.
5. 각 Fixture는 최신 Stay version을 사용하고, 각 호출에는 서로 다른 request_id를 사용한다.
6. 세션 시작 시각을 동일하게 맞춘다. 결과에서 SQLSTATE, 시작/종료 시각, Stay/Capacity/Allocation/Schedule/Audit fingerprint를 기록한다.

## 글로벌 Lock 순서

| 단계 | Lock | Key/대상 |
|---|---|---|
| 1 | Request advisory | `hotel-request:<request_id>` |
| 2 | Row | Stay → Capacity → 현재 Allocation → Schedule(UUID 순) |
| 3 | Room Type advisory | `hotel-capacity:<room_type_id>`를 UUID 오름차순 |
| 4 | Room advisory | `hotel-room:<room_id>`를 UUID 오름차순 |
| 5 | Total Capacity advisory | Capacity INSERT/UPDATE Trigger의 `hotel-capacity:all` |

신규 함수는 기존 `assert_hotel_capacity_available()` 및 `assert_hotel_room_allocation_available()`과 동일한 advisory key를 사용한다.

## 시나리오

### 1. 반대 방향 유형 이동

- Session A: STANDARD Stay를 DELUXE 빈 호실로 변경한다.
- Session B: DELUXE Stay를 STANDARD 빈 호실로 변경한다.
- 기대: 두 호출 모두 성공하거나, 한 요청이 Capacity/Version 충돌로 정상 종료한다. `40P01`은 없어야 한다.
- 검증: 유형 Lock과 Room Lock이 각 UUID 오름차순으로 획득되고, 각 Stay의 활성 Capacity는 정확히 1건이다.

### 2. 동일 Room 동시 경쟁

- Session A/B: 서로 다른 기존 유형 Stay를 동일한 대상 Room으로 변경한다.
- 기대: 한 요청만 성공하고 다른 요청은 `23P01`로 실패한다.
- 검증: 실패 Stay의 Capacity, Allocation, Schedule 제목, Stay version, Audit fingerprint가 시작 전과 같다.

### 3. 마지막 Room Type Capacity 경쟁

- 대상 유형의 안전 잔여를 1로 만든다.
- Session A/B: 서로 다른 Stay를 동시에 해당 유형으로 변경한다.
- 기대: 한 요청만 성공하고 다른 요청은 Capacity 오류로 실패한다. `40P01`은 없어야 한다.
- 검증: 대상 유형 예약 수가 활성 호실 수를 초과하지 않는다.

### 4. 입실 전 배정 해제 vs 유형 변경

- 동일 Stay/version을 사용한다.
- Session A: `unassign_hotel_room_before_check_in()`.
- Session B: `change_room_type_before_check_in()`.
- 기대: 한 요청만 성공하고 다른 요청은 `40001` 또는 계약 검증 오류로 종료한다.
- 검증: 활성 Allocation은 0건 또는 새 유형의 정확히 1건이며 중간 상태는 없다.

### 5. 입실 완료 vs 배정 해제

- Session A: 기존 `complete_hotel_check_in()`.
- Session B: `unassign_hotel_room_before_check_in()`.
- 기대: 입실 완료가 먼저면 해제는 차단된다. 해제가 먼저면 입실 완료는 미배정 계약에 따라 차단된다.
- 검증: 입실 완료 Stay가 호실 미배정 상태로 남지 않는다.

### 6. 입실 후 반대 방향 이동

- Session A/B가 서로 반대 유형으로 이동하며 서로의 기존 호실을 대상으로 한다.
- 기대: UUID 정렬 Lock으로 deadlock 없이 성공/충돌이 결정된다.
- 검증: 각 이동 시각에 해당하는 현재 Allocation은 정확히 1건이고 구간이 겹치지 않는다.

### 7. Audit/Schedule 실패 원자성

- QA 트랜잭션 안에서만 대상 Schedule 또는 Stay UPDATE에 실패를 주입한다.
- 교차 유형 RPC를 호출한다.
- 기대: 호출 실패 후 Capacity, Allocation, Schedule, Stay, Audit fingerprint가 모두 시작 전과 같다.

## 합격 기준

- 모든 시나리오에서 `40P01 deadlock_detected`가 0건이다.
- 충돌은 `23P01`, `40001` 또는 명시적 Capacity/계약 오류로 끝난다.
- 실패 요청의 Capacity, Allocation, Schedule, Stay, Audit 변경은 전부 롤백된다.
- 성공 요청마다 Hotel Stay root audit은 request_id 기준 정확히 1건이다.
- Snapshot과 Room Board가 성공 결과를 즉시 동일하게 표시한다.
