# 파일 업로드 수명주기·미리보기

- 상태: 구현·통합·격리 PostgreSQL 검증 완료
- 생성일: 2026-10-14
- 작업 브랜치: `fix/uiux-file-lifecycle`
- 성격: 감사 결과의 실행 태스크. 각 ID는 로컬 감사 식별자이며 외부 이슈 번호가 아니다.

## F05 · P1 — 업로드 확인 실패의 안전한 복구

- 범위: `frontend/src/lib/api.ts upload flow, backend confirm/rollback 계약`
- 작업: confirm 응답 손실을 파일 미생성으로 단정하여 일반 DELETE하지 않는다. pending만 rollback하고 확인 재시도/상태 조회의 idempotency를 검토한다.
- 완료 조건·검증: confirm 서버 성공→응답 손실, 중복 confirm, 업로드 실패, pending 만료를 주입해 성공한 파일·데이터가 삭제되지 않음을 검증한다.
- 상태: 완료 — confirm replay·상태 확인 및 pending-only cancellation. 성공한 파일은 rollback으로 삭제하지 않는다. 같은 세션의 focus 재검증에도 선택 파일·uncertain 참조·진행 중 job과 완료 receipt를 보존한다.

## F19 · P2 — 큰 텍스트/JSON 미리보기 비용 제한

- 범위: `frontend/src/pages/file.tsx, JSON preview components`
- 작업: response.ok 검증 후 읽는다. 무제한 전체 파싱을 피하고 byte 제한/취소/안내를 제공한다. JSON Show more는 페이지 단위로 늘린다.
- 완료 조건·검증: 큰 UTF-8/JSON·HTTP 오류·잘못된 JSON·빠른 파일 전환에서 메모리/메인 스레드 비용과 오류 복구를 테스트한다.
- 상태: 완료 — HTTP 상태·512 KiB stream 한도·AbortController, 큰 파일 download-only 안내와 JSON 100-node 단위 펼치기를 적용했다.

## F20 · P2 — 만료된 파일 URL 갱신 경로

- 범위: `frontend/src/pages/file.tsx 및 기존 파일 API`
- 작업: 단기 URL 만료 시 Refresh link/재발급 진입점을 제공한다. 파일 삭제·권한 회수와 단순 만료를 구별한다.
- 완료 조건·검증: URL 만료→갱신 성공, 403/404, 재발급 지연 및 빠른 파일 전환을 검증한다.
- 상태: 완료 — Refresh link와 다운로드 정보 복구를 제공하며, 403/404에서는 private 파일 정보를 제거한다.

## 공통 완료 기준

관련 실패 시나리오를 회귀 테스트로 추가하고 해당 테스트·타입·린트·디자인 토큰 검사를 통과한다. 구현된 범위와 남은 경계는 별도로 기록한다. UI 상태 변경으로 서버 권한을 우회하지 않으며 프로덕션 데이터·배포는 변경하지 않는다.
