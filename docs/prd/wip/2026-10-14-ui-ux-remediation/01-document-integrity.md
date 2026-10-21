# 문서·Guide 초안과 메타데이터 보존

- 상태: 구현·통합 검증 완료 — 전역 탐색 경계 포함
- 생성일: 2026-10-14
- 작업 브랜치: `fix/document-draft-integrity`
- 성격: 감사 결과의 실행 태스크. 각 ID는 로컬 감사 식별자이며 외부 이슈 번호가 아니다.

## F03 · P1 — Guide 편집 중 초안 손실 방지

- 범위: `frontend/src/components/skill/skill-section.tsx, frontend/src/pages/vault-settings.tsx`
- 작업: 조회 응답 변경이나 편집 진입으로 사용자의 입력을 덮어쓰지 않는다. 저장·취소를 구분하고 참여 중인 내부 이동 및 브라우저 뒤로 가기에 미저장 확인을 적용한다.
- 완료 조건·검증: 입력 후 Guide 이력·Vault 메뉴·브라우저 Back에서 유지/폐기 선택을 검증한다. 저장 실패 후 내용과 revision을 유지한다. 전역 미참여 링크는 별도 F08 경계 작업으로 남긴다.
- 상태: 완료 — 초안·revision 보존과 F08의 공통 Router guard를 결합해 AppSidebar·Settings·일반 링크·Back/Forward까지 보호한다.

## F04 · P1 — Summary·Domain 지우기 저장 계약 정리

- 범위: `frontend/src/lib/document-details.ts, backend 문서 update 모델·서비스 테스트`
- 작업: 빈 입력은 명시적인 빈 문자열로 전송한다. 기존 API의 omitted/null = 변경 없음 계약은 유지한다. 과거 감사의 null 지우기 제안은 호환성 재검증으로 정정한다.
- 완료 조건·검증: UI 빈 입력 저장·재조회와 Git/Native 서비스의 omitted·null·empty 문자열을 각각 회귀 테스트한다.
- 상태: 완료 — UI 빈 문자열 지우기와 Native/Git 계약 회귀 검증.

## F17 · P2 — Guide 조회 실패와 미설정 상태 구별

- 범위: `frontend/src/pages/vault-settings.tsx, frontend/src/pages/vault.tsx, SkillSection`
- 작업: 404만 미설정으로 취급한다. 통신/권한/서버 오류는 실패 안내와 Retry를 제공하고 기존 데이터를 잘못된 미설정 안내로 바꾸지 않는다.
- 완료 조건·검증: 404/403/500/일시 실패→Retry 성공을 구분하고, 실패 중 자동 생성·설정 안내를 잘못 노출하지 않는다.
- 상태: 완료 — Settings·Overview 실패/미설정 구분과 Retry 검증.

## F24 · P2 — 문서 canonical 이동 문맥 보존

- 범위: `frontend/src/pages/document.tsx`
- 작업: 문서 slug/ID 정규화 이동에서 query·hash·location state를 보존한다. 자동 이동은 replace를 유지한다.
- 완료 조건·검증: 기존 검색 파라미터·anchor·미리보기 복귀 state가 canonical 경로에서도 유지되는지 테스트한다.
- 상태: 완료 — canonical query·hash·state 보존 회귀 검증.

## F25 · P2 — Relations의 늦은 응답 격리

- 범위: `frontend/src/pages/document.tsx`
- 작업: 문서·계정·권한 범위가 바뀌면 이전 관계 조회 응답 및 오류를 폐기한다.
- 완료 조건·검증: A 문서 요청 지연 중 B로 이동했을 때 A 관계나 오류가 B에 나타나지 않는다. 재조회·실패 복구를 검증한다.
- 상태: 완료 — 관계 요청의 resource/account/revision 소유권 검증.

## 공통 완료 기준

관련 실패 시나리오를 회귀 테스트로 추가하고 해당 테스트·타입·린트·디자인 토큰 검사를 통과한다. 구현된 범위와 남은 경계는 별도로 기록한다. UI 상태 변경으로 서버 권한을 우회하지 않으며 프로덕션 데이터·배포는 변경하지 않는다.
