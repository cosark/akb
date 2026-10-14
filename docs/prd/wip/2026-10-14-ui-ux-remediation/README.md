# AKB UI/UX 감사 후속 개선 실행 계획

- 상태: WIP — F01–F30·UX01–UX12 구현·통합 검증 완료, PR 준비
- 생성일: 2026-10-14
- 기준 형상: `main 63eb62ec`의 stable account identity 및 격리 테스트 런타임 계약을 반영했다.
- 범위: UI/UX 감사의 기능·화면 개선과 공개 PR 검토. 프로덕션 배포와 PR merge는 별도 운영 단계다.

## 목표와 작업 순서

비개발자가 이해할 수 있는 화면은 실제 상태와 기능 계약을 정직하게 보여줘야 한다. 먼저 입력 손실·권한 오류·닫기/포커스 실패를 고친 후, 안정된 계약 위에서 정보 구조와 시각 밀도를 개선한다. 아래 30개 F 항목은 각각 독립적인 구현·검증 태스크이고, UX 항목은 별도의 화면 구성 작업이다. 1차 결과와 이후 “전부 진행” 요청에 따른 2차 통합 결과를 구분해 기록한다.

각 구현은 감사 시점의 추정에만 의존하지 않고 실패 조건을 다시 확인하고 회귀 테스트로 검증한다. 브라우저 fixture 검사를 실서비스 로그인·업로드 장애 검증의 대체로 취급하지 않는다.

## 실행 묶음

| 묶음 | 항목 | 현재 상태 | 선행 조건 |
|---|---|---|---|
| [01 문서 보존](01-document-integrity.md) | F03/F04/F17/F24/F25 | 전역 guard 포함 구현 완료 | 없음 |
| [02 Vault 권한·링크](02-vault-governance.md) | F02/F12/F13/F14/F15, F01 일부 | 해당 범위 완료 | 없음 |
| [03 Overlay 접근성](03-overlay-accessibility.md) | F09/F10/F11/F21 | 해당 범위 완료 | 없음 |
| [04 계정·세션 경계](04-identity-session-boundaries.md) | F01/F06/F07/F08/F29 | 구현·통합 검증·receipt 리뷰 완료 | 01/02 결과와 경계 통합 |
| [05 파일 수명주기](05-file-upload-preview.md) | F05/F19/F20 | 구현·통합 및 격리 PG 검증 완료 | confirm API 계약 검토 |
| [06 조회·이력](06-table-query-history.md) | F16/F22/F23 | 구현 완료 | 03 overlay 기준 |
| [07 피드백·인벤토리](07-feedback-and-inventory.md) | F18/F26/F27/F28/F30 | 구현·리뷰 수정 완료 | 해당 화면의 계정 경계 |
| [08 화면 구성](08-interface-composition.md) | UX01–UX12 | 구현·화면/반응형·통합 검증 완료 | 관련 F 안정화 |

F01/F05/F06은 2차에서 우선 처리했다. 화면 디자인 개선을 이유로 데이터 보존·권한 문제를 뒤로 미루지 않는다.

## 신규 워킹트리와 소유 범위

| 작업 묶음 | 책임 |
|---|---|
| 통합 | 태스크·검증 기준·최신 main 호환 |
| 문서 보존 | 01 문서·Guide·metadata |
| Vault 권한 | 02 access service·Members·Public links |
| Overlay 접근성 | 03 Invite·Preview·Table overlay/form |
| 계정·세션 | 04 account/SSO/Router/Settings·동일 세션 초안 |
| 파일 수명주기 | 05 confirm/pending cancellation·File preview |
| 피드백·조회 | 06/07 table/history/notification/theme/Home |
| 화면 구성 | 08 화면 계층·밀도·반응형·공개 표면 |

기존 기본 checkout의 브랜치·CI 수정 작업은 그대로 보존한다. 각 워킹트리는 최신 main에서 시작했고 서로의 파일을 덮어쓰지 않는다. 독립 변경을 검토한 뒤 통합 브랜치에 한 번 모아 전체 테스트한다. 미완료 워킹트리는 보관하고 무단 archive하지 않는다.

## 공통 검증·완료 조건

- 해당 실패를 고정하는 unit/API/browser regression을 추가한다. 구현 범위·증거·남은 한계를 구분한다.
- frontend: `pnpm run design:check`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`.
- backend: 변경한 서비스의 unit tests 및 관련 계약 테스트. public/member 조합과 Native/Git 계약 차이를 포함한다.
- 실제 브라우저 overlay 확인은 별도 로컬 포트와 fixture API에서 수행한다. 사용 중인 `:3000`과 운영 데이터에 쓰지 않는다.
- 지원하지 않는 값은 unknown/없음으로 표시한다. UI 권한 숨김은 서버 검사 대체가 아니다.
- 신규 hex·중복 디자인 토큰·마케팅 전용 규칙은 도입하지 않는다. AKB DESIGN_SYSTEM 정본을 따른다.

## 재검증으로 정정한 내용

1. F04: `null`은 기존 API/MCP에서 “변경 없음”으로 사용한다. 명시적 지우기는 UI에서 `""`로 전송하는 것이 호환 안전하다.
2. F01: Table/Graph 등 이미 경계를 둔 화면까지 일괄 재작성하지 않는다. 검증된 취약 경로만 수정하며 Members/Publications 완료가 전체 F01 완료를 뜻하지 않는다.
3. F11: 부모 스크롤 이동은 빠른 열기/닫기·포커스 타이밍 조건에서 발생한다. 일반적인 모든 Schema 열기가 항상 실패하는 것은 아니다.
4. 디자인 audit의 lint 경고 수는 제품 버그 개수가 아니다. 각 항목의 재현 조건을 기준으로 판단한다.

## 1차 구현 결과 (이력)

1차 시점에는 13개 F 항목의 지정 범위를 완료했고 F03 및 F01은 부분 완료였다. 당시 남겼던 04–08 묶음은 2차에 구현해 통합했다. [검증 기준](verification.md)은 현재 구현의 재현 방법·범위·한계를 설명한다.

공통 Shell 시작·계정 교체·foreground 권한 재검증 때 공유 Vault 조회의 소유권도 분리했다. 이전 요청 완료가 새 요청의 공유 슬롯을 지우지 않도록 보호한다. 이는 F01의 모든 화면별 private state 감사를 대체하지 않는다.

## 최종 구현 결과

이 계획에 등록한 F01–F30과 UX01–UX12를 구현·통합했다. 이후 Members 초대의 행별 역할 선택, Vault 작업 화면의 탐색 축소, 문서 전용 Vault 메뉴와 발행 도구 배치를 보완했다. 각 경계의 회귀 테스트와 검증 방법은 [verification.md](verification.md)에 정리한다.

이는 모든 운영 환경·모든 가능한 사용 흐름에 오류가 없다는 보증이 아니다. 검사 범위와 미검증 경계는 [verification.md](verification.md)에 기록했다. main merge 전이므로 이 문서는 WIP에 유지한다.
