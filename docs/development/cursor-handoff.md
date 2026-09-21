# Cursor 인수인계

## 현재 상태

단일 화면 MVP가 구현되어 있다. 핵심 로직은 `lib/formatter.mjs`, 클립보드 계층은 `lib/clipboard.mjs`, 화면은 `app/page.tsx`에 있다.

## 변경 시 지켜야 할 계약

- 입력 원고를 서버, 분석 도구, 브라우저 저장소로 보내지 않는다.
- 원문 HTML은 실행하지 않는다. `dangerouslySetInnerHTML`에는 포매터가 이스케이프해 생성한 문자열만 전달한다.
- 분리 규칙 우선순위는 `독립 구분선 → 글 번호 → 반복 H1 → 단일 글`이다.
- 안전 복사는 항상 유지한다. 서식 복사는 네이버 호환을 보장하는 기능으로 표현하지 않는다.
- 표 색상 값은 6자리 hex만 허용한다.

## 다음 후보 작업

1. 실제 네이버 SmartEditor에서 Chrome·Whale별 붙여넣기 결과를 수동 기록한다.
2. 사용 사례가 확인되면 카드 단위 수동 분리·병합·재정렬을 추가한다.
3. 문법 교정이 필요하면 개인정보 처리와 비용 정책을 먼저 정한 뒤 명시적 선택 기능으로 분리한다.

## 검증 명령

```bash
npm run test:coverage
npx tsc --noEmit
npm run lint
npm run build
```
