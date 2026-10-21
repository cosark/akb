# 피드백·인벤토리·환경 복구

- 상태: 구현·통합 검증·리뷰 수정 완료
- 생성일: 2026-10-14
- 작업 브랜치: `fix/uiux-feedback-query`
- 성격: 감사 결과의 실행 태스크. 각 ID는 로컬 감사 식별자이며 외부 이슈 번호가 아니다.

## F18 · P2 — Graph 원격 선택 리소스의 가시성

- 범위: `Graph filters/selection state`
- 작업: 선택한 리소스 kind가 숨김 상태면 범위를 자동 복구하거나 명확한 Show action을 제공한다.
- 완료 조건·검증: 문서/파일/테이블 필터와 remote search 선택 조합에서 선택 항목이 보이거나 숨긴 이유를 확인할 수 있다.
- 상태: 완료 — remote 선택의 kind 필터·숨김·orphan 범위를 복구하며 canvas/renderer 상태를 유지한다.

## F26 · P2 — 알림 읽음 처리와 목적지 이동 분리

- 범위: `Notification menu/page handlers`
- 작업: mark-as-read 실패가 유효한 문서/Vault 이동을 막지 않는다. 읽음 처리는 실패 피드백 및 재시도 대상으로 분리한다.
- 완료 조건·검증: 읽음 API 오류에도 목적지 이동, 정보 전용 이벤트는 이동 없음, 중복 클릭/권한 회수 조합을 테스트한다.
- 상태: 완료 — 이동과 읽음 처리를 분리한다. route를 떠나도 Shell에서 Retry/Dismiss가 유지되며 version conflict는 새 알림을 먼저 검토하게 한다.

## F27 · P2 — Admin 임시 비밀번호 Copy 피드백

- 범위: `Admin reset password dialog`
- 작업: clipboard API 부재·권한 실패에서 Copied를 거짓 표시하지 않고 수동 선택/복사 경로를 제공한다.
- 완료 조건·검증: 지원 없음·reject·success 세 경우를 테스트하고 secret logging을 금지한다.
- 상태: 완료 — 성공한 clipboard 쓰기에서만 Copied를 표시하고 실패/미지원은 수동 선택·복사를 제공한다.

## F28 · P2 — 테마 localStorage 실패 내구성

- 범위: `Theme provider`
- 작업: storage 읽기/쓰기 예외가 앱을 중단시키지 않도록 보호하고, 저장 실패에도 현재 화면 테마 변경은 적용한다.
- 완료 조건·검증: SecurityError/QuotaExceededError와 저장 성공, system theme 변경을 테스트한다.
- 상태: 완료 — 읽기/쓰기 storage 예외에도 화면 테마 변경·system theme·공유 consumer 동기화가 동작한다.

## F30 · P2 — Home 인벤토리 캐시 갱신·실패 복구

- 범위: `Home inventory query/cache`
- 작업: 실패를 영구 Done으로 기록하지 않는다. 계정·access revision·리소스 mutation에 맞춰 갱신하며 기존 빠른 초기 표시와 없는 값 구분을 유지한다.
- 완료 조건·검증: 첫 요청 실패→Retry, 권한/계정 변경, 문서/파일/테이블 생성·삭제 및 TTL 갱신을 검증한다.
- 상태: 완료 — account/revision query key, 30초 TTL, Retry 및 resource write invalidation을 적용한다. write 이전에 시작한 공유 조회는 갱신 결과를 덮어쓰지 못한다.

## 공통 완료 기준

관련 실패 시나리오를 회귀 테스트로 추가하고 해당 테스트·타입·린트·디자인 토큰 검사를 통과한다. 구현된 범위와 남은 경계는 별도로 기록한다. UI 상태 변경으로 서버 권한을 우회하지 않으며 프로덕션 데이터·배포는 변경하지 않는다.
