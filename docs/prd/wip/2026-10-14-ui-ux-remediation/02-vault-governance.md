# Vault 권한과 Public links 상태

- 상태: 지정 범위 구현·검증 완료
- 생성일: 2026-10-14
- 작업 브랜치: `fix/vault-role-and-link-state`
- 성격: 감사 결과의 실행 태스크. 각 ID는 로컬 감사 식별자이며 외부 이슈 번호가 아니다.

## F02 · P1 — 공개 역할과 명시적 멤버 역할의 유효 권한 계산

- 범위: `backend/app/services/access_service.py 및 서비스 테스트`
- 작업: public reader가 명시적 writer/admin을 낮추지 않도록 유효 역할을 계산한다. owner/system admin 및 archived 정책은 유지하고 역할 출처도 실제 계약과 맞춘다.
- 완료 조건·검증: public/member 조합 전체와 비멤버 공개 접근, owner, 관리자, archived 접근을 테스트한다.
- 상태: 완료 — service 및 accessible-directory 역할 우선순위·출처 검증.

## F12 · P2 — 공개 링크 전달 방식과 사용 가능 상태 분리

- 범위: `frontend/src/pages/publications.tsx 및 상태 helper`
- 작업: Live/Snapshot은 전달 방식, Active/Expired/View limit reached는 가용 상태로 분리한다. 없는 만료·조회 제한 값은 추측하지 않는다.
- 완료 조건·검증: 만료·조회 한도·snapshot/live·누락 필드 조합에서 뱃지와 보조 정보가 정확히 표시된다.
- 상태: 완료 — 상태 조합 및 누락값 회귀 검증.

## F13 · P1 — Revoke 후 남는 공개 접근 설명

- 범위: `frontend/src/pages/vault-members.tsx`
- 작업: 멤버 권한 제거와 Vault 공개 접근 제거를 같은 것으로 설명하지 않는다. 공개 역할이 남으면 확인창과 완료 피드백에 명시한다.
- 완료 조건·검증: private/public 및 역할 조합별 revoke 문구와 실제 서비스 권한을 대조한다.
- 상태: 완료 — 공개 접근 잔존 여부 안내 검증.

## F14 · P2 — Reader·Archived 작업 제한의 정직한 UI

- 범위: `frontend/src/pages/vault-members.tsx, frontend/src/pages/publications.tsx`
- 작업: 서버에서 거부하는 Unpublish/멤버 변경 작업은 비활성 이유를 표시한다. 소유권 이전은 별도 정책으로 취급한다.
- 완료 조건·검증: reader/writer/admin/owner, archived/active 상태를 테스트하고 불가능한 변경 요청이 발생하지 않는지 확인한다.
- 상태: 완료 — reader/archived/managed 제한, system-admin 예외와 transfer 정책 검증.

## F15 · P2 — Members·Publications의 Vault 전환 응답 격리

- 범위: `frontend/src/pages/vault-members.tsx, frontend/src/pages/publications.tsx`
- 작업: 계정·access revision·Vault 단위로 화면 상태를 격리한다. 검증 중에는 민감 데이터를 노출하지 않고 이전 조회·보강·변경 완료 응답을 무시한다.
- 완료 조건·검증: A 요청 지연 중 B Vault/계정으로 바꾸어 이전 멤버·공개 링크·완료 토스트가 B에 섞이지 않음을 테스트한다. F01의 이 두 화면만 먼저 해결한다.
- 상태: 완료 — Members/Publications 범위 격리 및 권한 실패 후 Retry permissions 검증. F01 전체 완료를 뜻하지 않는다.

## 공통 완료 기준

관련 실패 시나리오를 회귀 테스트로 추가하고 해당 테스트·타입·린트·디자인 토큰 검사를 통과한다. 구현된 범위와 남은 경계는 별도로 기록한다. UI 상태 변경으로 서버 권한을 우회하지 않으며 프로덕션 데이터·배포는 변경하지 않는다.
