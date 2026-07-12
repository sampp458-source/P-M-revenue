# Supabase Auth 설정

P&M 내부 프로그램은 Supabase Auth의 **Email + Password** 로그인만 사용한다.

## 애플리케이션 설정

- 로그인 API: `signInWithPassword`
- 세션 저장: 사용
- 토큰 자동 갱신: 사용
- URL의 인증 토큰 감지: 사용하지 않음
- 공개 회원가입 UI: 제공하지 않음
- Magic Link, OTP, 이메일 링크, 비밀번호 재설정 이메일: 제공하지 않음

## Supabase Dashboard 확인 순서

1. **Authentication > Providers > Email**에서 Email provider를 활성화한다.
2. 운영 계정은 **Authentication > Users**에서 관리자가 직접 생성한다.
3. 공개 회원가입을 허용하지 않는 운영 정책에 맞춰 **Allow new users to sign up**을 비활성화한다.
4. **Authentication > URL Configuration**의 Site URL은 로컬 검수 중 `http://127.0.0.1:5173`으로 설정한다.
5. Redirect URLs에서 Magic Link, OTP, 이메일 확인, 비밀번호 복구에 사용하던 callback URL을 제거한다.

Email + Password 로그인 자체는 redirect URL을 사용하지 않는다. 향후 운영 주소가 확정되기 전까지 배포 주소를 추가하지 않는다.
