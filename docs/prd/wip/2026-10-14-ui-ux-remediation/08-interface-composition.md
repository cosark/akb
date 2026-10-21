# 화면 구성·시각 디자인 후속 태스크

- 상태: 구현·화면·반응형·통합 검증 완료
- 생성일: 2026-10-14
- 작업 브랜치: `feat/uiux-interface-composition`, 관련 기능은 04–07 독립 브랜치에서 병행 검증했다.
- 선행 조건: 저장·권한·overlay 안정화. 1차 결과와 구분해 2차에 구현했다.

Frontend Design의 의도적인 시각 계층과 UI/UX Pro Max의 포커스·반응형 가이드를 적용하되, AKB `frontend/DESIGN_SYSTEM.md`와 기존 토큰이 정본이다. Design Taste는 마케팅 페이지 중심이므로 앱 화면에 사진·과장된 hero·마케팅 밀도 규칙을 강제하지 않는다.

| ID | 작업 | 설계·완료 기준 |
|---|---|---|
| UX01 | 공통 Shell·breadcrumb·sidebar | global/Vault/Collection 층의 역할과 높이를 명확히 한다. 접힘 상태의 로고·하단 액션 좌표, focus-visible, 좁은 화면 메뉴 접근성을 실제 화면 비교로 검증한다. |
| UX02 | Home·Vault directory | Continue working·Recent updates·Watching의 primary action과 Open in Vault를 명확히 한다. 실제 많은 Vault와 빈 상태에서 카드 밀도·summary 가독성·비대칭 여백을 비교한다. F30 선행. |
| UX03 | Vault Overview | 상단 identity·inventory·생성 action과 하단 Guide/access/activity를 역할별로 배치한다. 중복 지표를 줄이고 긴 설명·대량 리소스·Guide 오류에서 계층이 유지되도록 한다. |
| UX04 | 문서 Viewer·미리보기 | Rendered/Raw·copy/edit/publish와 inspector의 의미를 분리한다. page/modal의 reading inset을 같은 토큰으로 조절하고 긴 summary·code/table·outline의 초점 이동을 확인한다. F10/F24/F25 선행. |
| UX05 | 문서 작성·편집 | Title/body와 Collection/details의 보조 구조를 일관되게 한다. 큰 본문·이미지·table의 편집 성능, 저장/취소·미저장 피드백을 검증한다. F03/F04 선행. |
| UX06 | Vault/Account Settings | section 제목·tabs·가이드 역할을 단순화하고 조건별 지원/권한을 표시한다. Profile·Agent connections의 기존 기능 및 3단계 의미를 보존한다. F06/F07/F08 선행. |
| UX07 | Search·전역 검색 모달 | modal 빠른 탐색과 전용 페이지 심층 필터를 분리한다. 다중 Vault chips·Collection 범위·content type·results/viewer 복귀 상태를 일관되게 한다. 키보드·좁은 화면·빈 결과를 검증한다. |
| UX08 | Members·Public links·Activity | 권한/접근과 링크 가용성, commit history를 섞지 않는다. 조밀한 표와 설명의 우선순위를 비교하고 숫자·badge·action을 같은 규칙으로 표시한다. F12–F16 선행. |
| UX09 | File·Table inspector | 표·파일 종류·schema·cell 원문을 선택적으로 제공한다. inspector가 내용 폭을 밀지 않고 큰 JSON과 narrow workspace에서도 액션이 접근 가능하다. F11/F19/F20/F21/F22 선행. |
| UX10 | Graph | Obsidian형 관계 지도 중심을 유지하고 kind 색/모양/범례를 함께 제공한다. 검색·filter는 canvas 위 floating 도구로 정리하고 연결 0/대량 그래프·선택 복구를 검증한다. F18 선행. |
| UX11 | Notification·Watching | 이동 가능한 이벤트와 정보 전용 이벤트를 시각·문구로 구별하고 범주·읽음·시간 계층을 정리한다. F26 선행. |
| UX12 | Auth·공개 Viewer·Admin | branded 공개 표면과 관리 작업을 분리한다. 로그인 오류·권한·secret 수명주기·실패 복구 문구를 검토한다. F27/F29 선행. |

## 작업 방법

각 태스크는 구현 전에 현재 route·기능 계약·실제 viewport 스크린샷을 확인한다. desktop/fullscreen·좁은 화면·dark·빈/오류/대량 데이터에서 검증한다. 디자인 변경은 기존 기능을 삭제하거나 placeholder로 바꾸는 완료 방식으로 인정하지 않는다. 한 번에 모든 화면을 덮지 않고 독립 브랜치에서 검증한 뒤 통합한다.

## 적용 결과

| 항목 | 적용 내용 |
|---|---|
| UX01 | 접힌/펼친 sidebar의 로고·Help·Settings icon 좌표를 고정하고 다크 모드 wordmark 대비를 보정했다. private Vault 목록도 검증 epoch에 맞춘다. |
| UX02 | Vault directory를 설명 hero 대신 검색 가능한 직접 목록으로 바꿨다. Favorites/Owned 필터, 30개씩 Show more, 빈 상태 CTA를 제공한다. Home 빈 상태와 최근 행 밀도를 줄였다. |
| UX03 | Overview context를 중간 폭에서는 2열, 넓은 폭에서는 오른쪽 rail로 배치했다. Guide는 중첩 frame을 제거하고 실패/미설정/시간 unknown을 구별한다. |
| UX04 | 수정 시간을 읽기 쉬운 크기로 맞추고 Details의 선택 정보 구분선을 정리했다. page/modal 공통 reader와 overlay·outline·canonical 복귀 동작을 유지한다. |
| UX05 | 좁은 editor formatting toolbar는 가로 스크롤 또는 펼치기로 접근한다. 모든 command와 편집기 인스턴스·모드 전환·큰 본문 성능 계약은 보존한다. |
| UX06 | Agent connection은 도구를 선택하기 전에도 기존 3단계 흐름을 보여준다. 계정/지원 조건·폼 오류·미저장/처리 중 상태를 일관되게 표시한다. |
| UX07 | Search result 간격·요약을 압축하되 multi-Vault/Collection 범위·필터·viewer 복귀 상태와 접근성은 유지한다. |
| UX08 | Members의 역할·public policy·managed/archived 제한을 구분한다. Public links는 30개씩 펼치고 링크 주소는 선택적으로 확인한다. Activity는 최신 로드 범위를 명시한다. |
| UX09 | File info는 overlay로 Fit/Actual size/Refresh/download를 제공한다. JSON 비용 제한과 Table cell 원문/Schema/row form의 키보드·터치 접근성을 보완한다. |
| UX10 | floating 도구·kind 구분·지도 중심을 유지하면서 선택한 숨김 리소스를 복구한다. |
| UX11 | 이동 가능한 알림은 semantic link, 정보 전용은 Notice only로 구별한다. 읽음 실패는 독립된 Shell 피드백으로 남긴다. |
| UX12 | Admin row action을 `…`로 모으고 display name·handle 계층을 구분한다. 공개 문서는 제목·작성자/날짜를 합치고 보조 metadata를 펼치기로 제공한다. Auth 설명은 version history/agent 기능 중심으로 정리한다. |

새 palette·font·마케팅 hero를 추가하지 않았다. 기존 DESIGN_SYSTEM의 token과 primitive를 사용했으며, 이 스킬 검토는 기능 보존과 progressive disclosure를 우선하는 방향으로 작업에 영향을 줬다.
