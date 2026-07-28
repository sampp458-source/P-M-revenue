# Operations 역할 Bootstrap

`202607280001_operations_foundation.sql` 적용 직후 기존 활성 사용자는 모두
Operations `staff`로 생성됩니다. 기존 `profiles.role`은 변경되지 않으며,
대표와 원장을 자동 추정하지 않습니다.

## 수동 지정 전 확인

Supabase SQL Editor에서 대상 사용자의 UUID, 이름, 이메일, 활성 상태를 먼저
조회합니다. `profiles.is_active = true`이고 `account_status = 'active'`인 승인된
사용자만 지정합니다.

```sql
select
  profile.id,
  profile.name,
  profile.email,
  profile.is_active,
  profile.account_status,
  membership.role as operation_role,
  membership.is_active as operation_active
from public.profiles profile
left join public.operation_memberships membership
  on membership.profile_id = profile.id
where profile.id = '<승인된 profile UUID>'::uuid;
```

## 역할 지정

운영자가 확인한 정확한 `profile_id` 한 건만 대상으로
`operation_memberships.role`을 `owner` 또는 `manager`로 변경합니다.

- `owner`: 대표. Operations 정책 변경의 최종 책임자
- `manager`: 원장. Calendar와 일정 유형 관리 가능
- `staff`: 설정 조회 가능

변경 전후에 대상 UUID와 현재 역할을 다시 조회하여 한 건만 변경되었는지
확인합니다. 앱에는 역할 변경 UI를 노출하지 않습니다.

```sql
begin;

select set_config(
  'app.operation_change_reason',
  'Operations 역할 수동 지정',
  true
);

update public.operation_memberships membership
set role = '<owner 또는 manager>'
where membership.profile_id = '<승인된 profile UUID>'::uuid
  and exists (
    select 1
    from public.profiles profile
    where profile.id = membership.profile_id
      and profile.is_active = true
      and profile.account_status = 'active'
  )
returning profile_id, role, is_active, updated_at;

commit;
```

`returning` 결과가 정확히 한 건이 아닐 경우 적용을 확정하지 말고 대상 UUID와
활성 상태를 다시 확인합니다.

## 신규 승인·비활성·복구

`profiles_sync_operation_membership` Trigger가 다음을 자동 처리합니다.

- 신규 직원 승인: 누락된 membership을 `staff`로 생성
- 직원 비활성화: membership을 비활성화
- 직원 복구: 기존 Operations 역할을 유지한 채 membership을 활성화

Operations 접근 판정은 membership뿐 아니라 `profiles.is_active`와
`profiles.account_status`도 함께 확인합니다.
