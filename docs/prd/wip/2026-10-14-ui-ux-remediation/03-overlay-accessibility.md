# 모달·Inspector 접근성과 입력 보호

- 상태: 지정 범위 구현·검증 완료
- 생성일: 2026-10-14
- 작업 브랜치: `fix/resource-overlay-accessibility`
- 성격: 감사 결과의 실행 태스크. 각 ID는 로컬 감사 식별자이며 외부 이슈 번호가 아니다.

## F09 · P2 — 모바일 Invite 본문 스크롤과 고정 액션

- 범위: `frontend/src/components/invite-member-dialog.tsx`
- 작업: Dialog의 높이 제한 안에서 header/footer는 유지하고 가운데 본문만 스크롤한다. 모바일 빈 결과 최소 높이를 줄이고 처리 중 잠금은 유지한다.
- 완료 조건·검증: 390px 및 낮은 높이에서 역할·선택·Invite/Cancel을 접근할 수 있다. 검색 결과가 길어도 footer가 화면 밖으로 사라지지 않는다.
- 상태: 완료 — 390px 폭, 540/320px 높이에서 body scroll 및 footer 접근을 Chromium으로 검증.

## F10 · P2 — 문서 미리보기 오류 화면 닫기 hit target

- 범위: `frontend/src/components/document-preview-dialog.tsx`
- 작업: 오류·로딩 콘텐츠 위에서도 Close 버튼이 보이고 클릭된다. 토큰 기반 stacking과 표면색으로 시각 대비를 확보한다.
- 완료 조건·검증: 403/404/503/로딩 상태에서 실제 브라우저로 Close 클릭·Escape·복귀 경로를 검증한다. 기존 draft 보호를 유지한다.
- 상태: 완료 — Loading·200·403·404·503에서 Close 클릭 및 검색 복귀 검증.

## F11 · P2 — Table Schema 포커스·overflow 경계 수정

- 범위: `frontend/src/pages/table.tsx`
- 작업: 닫힌 패널의 transform이 부모 scrollLeft를 바꾸지 않도록 overlay 경계를 분리한다. 좁은 작업 영역은 modal/focus trap, 넓은 영역은 비모달 inspector로 제공한다.
- 완료 조건·검증: 빠른 열기/닫기·Escape·좁은 영역 Tab·리사이즈·포커스 복귀를 검증한다. Schema를 열어도 테이블 좌표·폭·스크롤이 바뀌지 않는다.
- 상태: 완료 — rapid toggle·workspace 기반 modal·resize 왕복·focus 복귀·scrollLeft 0 회귀 검증.

## F21 · P2 — Table/Row 폼의 미저장 입력 폐기 확인

- 범위: `frontend/src/components/table-create-dialog.tsx, frontend/src/components/table-row-dialog.tsx`
- 작업: X·Cancel·Escape·backdrop 모두 동일한 dirty 확인을 사용한다. 저장 성공은 바로 닫고 실패/충돌은 초안을 유지한다. 저장 중 중복 작업을 막는다.
- 완료 조건·검증: 빈 폼은 즉시 닫힘, 변경 후 Keep editing/Discard, 원래 값 복원, null/invalid 값, schema 구조 변경, 저장 실패·409 충돌·처리 중 닫기 차단을 테스트한다.
- 상태: 완료 — dirty/null/invalid/schema 구조·실패·처리 중 잠금·explicit discard 검증. Row 닫기 후 호출 버튼 focus도 복원한다.

## 공통 완료 기준

관련 실패 시나리오를 회귀 테스트로 추가하고 해당 테스트·타입·린트·디자인 토큰 검사를 통과한다. 구현된 범위와 남은 경계는 별도로 기록한다. UI 상태 변경으로 서버 권한을 우회하지 않으며 프로덕션 데이터·배포는 변경하지 않는다.
