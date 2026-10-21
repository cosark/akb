# 테이블 조회·이력 탐색

- 상태: 구현·통합 검증 완료
- 생성일: 2026-10-14
- 작업 브랜치: `fix/uiux-feedback-query`
- 성격: 감사 결과의 실행 태스크. 각 ID는 로컬 감사 식별자이며 외부 이슈 번호가 아니다.

## F16 · P2 — Activity 작성자 필터와 조회 범위 안내

- 범위: `Activity UI 및 Native/Git history API`
- 작업: 최신 50개 이후 client filter를 전체 이력처럼 표시하지 않는다. 서버 필터/페이지 계약이 없으면 현재 범위를 명시한다. Native와 Git 지원 차이를 확인한다.
- 완료 조건·검증: 최신 50개 밖의 작성자 이력, 빈 결과, Native/Git 지원 차이 테스트. SQL 직접 select에 의무 pagination을 새로 부과하지 않는다.
- 상태: 완료 — 최신 50개 로드 범위와 필터 한계를 명시하고 Native/Git 계약을 구분한다. SQL 직접 조회의 pagination 정책은 변경하지 않았다.

## F22 · P2 — Read-only Table 긴 셀의 키보드 접근

- 범위: `frontend/src/pages/table.tsx, cell inspector`
- 작업: hover만으로 열리는 원문을 포커스·키보드·터치로도 제공한다. grid 전체 행에 무의미한 tab stop을 늘리지 않도록 설계한다.
- 완료 조건·검증: reader의 긴 값 보기·copy·Escape·포커스 복귀, 짧은 값과 긴 JSON/텍스트를 검증한다.
- 상태: 완료 — roving cell focus, Enter/터치 원문 inspector, Copy·Escape·포커스 복원. Read-only 사용자도 긴 값을 확인할 수 있다.

## F23 · P2 — Table URL query와 Back 복원

- 범위: `frontend/src/pages/table.tsx, table-query-state`
- 작업: 사용자가 선택한 filter/sort/page는 탐색 history에 의미 있게 남기고 자동 page 보정만 replace한다. 무관한 query를 유지한다.
- 완료 조건·검증: filter→page→sort→Back/Forward 상태 복원과 canonical page 보정의 history 수를 검증한다.
- 상태: 완료 — 사용자 선택은 push, 자동 page 보정은 replace, 무관한 query·Back/Forward 상태를 보존한다.

## 공통 완료 기준

관련 실패 시나리오를 회귀 테스트로 추가하고 해당 테스트·타입·린트·디자인 토큰 검사를 통과한다. 구현된 범위와 남은 경계는 별도로 기록한다. UI 상태 변경으로 서버 권한을 우회하지 않으며 프로덕션 데이터·배포는 변경하지 않는다.
