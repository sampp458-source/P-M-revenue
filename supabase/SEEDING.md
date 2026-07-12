# Phase 2 Seed 실행 원칙

## 선택한 방식

SQL seed에는 인증 사용자가 필요하지 않은 업무 기준 데이터만 포함한다.

- 고정 사업부 3개
- 상품 분류
- 상품
- 월 목표

보호자, 반려견, 매출과 매출 이력은 최초 관리자 생성과 로그인 이후 앱의 실제 CRUD로 생성한다.

## 이유

`sales.created_by`, `sale_history.changed_by`는 실제 `profiles.id`를 요구한다. Supabase SQL Editor에서는 `auth.uid()`가 `null`이므로 매출 seed를 직접 실행하면 등록자와 변경 이력의 무결성을 보장할 수 없다. 임의 UUID나 service role 우회로 매출 데이터를 만들지 않는다.

## 실행 순서

1. initial migration 실행
2. Supabase Authentication에서 최초 사용자 수동 생성
3. `bootstrap_first_admin.sql`의 이메일 placeholder 교체 후 실행
4. 기준 데이터 seed 실행
5. 최초 관리자로 앱 로그인
6. 보호자, 반려견, 매출 CRUD 검증

운영 데이터와 개발 샘플 데이터는 혼합하지 않는다. 기존 localStorage 데이터는 자동 업로드하지 않는다.
