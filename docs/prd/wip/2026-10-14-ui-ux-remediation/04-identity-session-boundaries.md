# 계정·세션·탐색 경계

- 상태: 구현·통합 검증 및 receipt 경계 리뷰 완료
- 생성일: 2026-10-14
- 작업 브랜치: `fix/uiux-session-boundaries`, 통합 Shell 보완은 `feat/uiux-remediation-plan`
- 성격: 감사 결과의 실행 태스크. 각 ID는 로컬 감사 식별자이며 외부 이슈 번호가 아니다.

## F01 · P1 — 전체 화면의 계정·ACL 전환 private state 경계

- 범위: `Layout, current-user context, Vault index/overview/activity/settings, Search`
- 작업: Query cache 초기화만으로 남는 로컬 useState를 정리한다. 페이지별 query key·private state·mutation generation을 조사하고 검증 중 stale 데이터는 가린다.
- 완료 조건·검증: 권한 회수/계정 교체/지연 응답 행렬 테스트. Members/Publications는 02에서 선행하며 Table/Graph의 기존 보호를 무조건 재작성하지 않는다.
- 상태: 완료 — Vault index/Overview/Activity/Settings/Search/미리보기와 Home, Vault rail/Favorites의 account·access revision 소유권을 검증했다. foreground proof 중 추가 identity 이벤트를 모으고 오래된 성공 응답도 폐기한다.

## F06 · P1 — 잘못된 현재 비밀번호와 세션 만료 분리

- 범위: `frontend/src/lib/api.ts, Account password UI, backend auth 계약`
- 작업: 인증 실패 401 중 현재 비밀번호 검증 실패가 정상 세션을 종료하지 않도록 오류 code/호출 문맥을 구별한다.
- 완료 조건·검증: 현재 비밀번호 오입력 후 로그인·폼 유지, 실제 expired token은 재인증 전환. 두 경로를 API/UI 테스트한다.
- 상태: 완료 — 서버는 `400 current_password_incorrect`, legacy 401은 같은 세션의 identity 재검증에 성공한 경우에만 폼 오류로 취급한다.

## F07 · P2 — 비밀번호 변경 후 세션 안내 일치

- 범위: `Account UI, backend/app/services/auth_service.py`
- 작업: 실제 토큰 세대 폐기 계약과 안내 문구를 맞춘다. 세션을 유지하려면 명시적인 갱신 계약이 필요하며 임의 우회를 하지 않는다.
- 완료 조건·검증: 변경 성공 후 현재/다른 세션의 실제 상태와 UI 피드백을 검증한다. F06 후 진행.
- 상태: 완료 — 성공 receipt에 귀속한 세션 폐기·새 비밀번호 재로그인 안내. 실제 Activity 숨김 중 완료되는 password/profile/PAT/Admin/Security mutation과 실제 account 교체를 회귀 검증했다.

## F08 · P2 — Settings 및 전역 탐색의 미저장/처리 중 보호

- 범위: `Settings modal provider, ResourceNavigationProvider, Workspace links`
- 작업: location.key 변경으로 폼을 무조건 종료하지 않고 내부 메뉴·브라우저 Back·전역 링크에 동일한 guard를 적용한다.
- 완료 조건·검증: Profile/Connections/Guide dirty와 pending 상태에서 각 이동 경로의 계속/폐기/잠금 동작을 테스트한다. F03의 참여 링크 밖을 포함한다.
- 상태: 완료 — Router push/replace, 참여 링크, indexed history에 공통 guard를 적용한다. Profile/Guide/PAT 초안은 같은 계정의 검증 중 유지하고 private 화면은 가린다.

## F29 · P2 — Admin SSO Provider 저장 결과 격리

- 범위: `frontend admin SSO provider editor`
- 작업: Provider A의 저장 완료가 Provider B의 secret/폼 상태를 지우지 않도록 요청 식별자와 편집 범위를 묶는다.
- 완료 조건·검증: A 저장 지연 중 B 편집, 실패·성공·provider 삭제를 테스트한다. 보안 값은 로그·스크린샷에 남기지 않는다.
- 상태: 완료 — Provider A의 늦은 저장 완료는 Provider B 폼·secret에 적용하지 않는다. 요청 owner와 provider revision을 검증한다.

## 공통 완료 기준

관련 실패 시나리오를 회귀 테스트로 추가하고 해당 테스트·타입·린트·디자인 토큰 검사를 통과한다. 구현된 범위와 남은 경계는 별도로 기록한다. UI 상태 변경으로 서버 권한을 우회하지 않으며 프로덕션 데이터·배포는 변경하지 않는다.
