# 전국 통합돌봄 사업 총괄 대시보드 Design System

## 1. Atmosphere & Identity

공공 업무용 통계 화면답게 차분하고 명확한 인상을 유지한다. 흰색 데이터 표면과 옅은 청회색 배경을 경계선으로 구분하고, 짙은 행정 블루를 선택·강조 상태에만 사용한다. 대표 시각 요소는 복잡한 장식 없이 전국의 지역별 차이를 빠르게 비교하게 하는 데이터 밀도다.

## 2. Color

### Palette

| Role | Token | Light | Usage |
|---|---|---|---|
| Page surface | `--background` | `#f1f4f9` | 전체 배경 |
| Primary text | `--foreground` | `#16212f` | 본문, 제목 |
| Panel surface | `--card` | `#ffffff` | 카드, 패널, 헤더 |
| Brand/action | `--primary`, `--care-blue` | `#0173bc` | 주요 버튼, 수치, 지도·바로선택 호버 및 선택 상태 |
| Brand/action text | `--primary-foreground` | `#ffffff` | 강조 표면 위 텍스트 |
| Positive/data | `--care-green` | `#009f74` | 보조 데이터, 지도 포커스 상태 |
| Attention | `--care-orange` | `#f08101` | 순위 포인트, 데이터 강도 보조 강조 |
| Map ramp | `--map-region-empty` … `--map-region-high` | `#f8fbfc` → `#fde5c8` | 지역별 사업 수 강도 |
| Map outline | `--map-region-border` | `#6f8b9b` | SVG 행정경계 외곽선 |
| Map panel wash | `--map-panel-blue-wash`, `--map-panel-green-wash` | `#f4fbff`, `#f0fbf7` | 지도 패널의 옅은 브랜드 그라데이션 |
| KPI wash | `--kpi-blue-wash`, `--kpi-green-wash`, `--kpi-orange-wash` | `#eef8ff`, `#effbf7`, `#fff7ed` | 핵심 현황 카드의 옅은 데이터 그라데이션 |
| Attention text | `--attention-foreground` | `#924b00` | 주황색 상태 표면 위 텍스트 |
| Secondary surface | `--secondary` | `#e7edf6` | 보조 버튼, 선택 전 상태 |
| Muted surface | `--muted` | `#eef2f7` | 비활성·낮은 강도 데이터 |
| Muted text | `--muted-foreground` | `#566577` | 설명, 메타데이터 |
| Border | `--border` | `#d7dfea` | 카드와 구획 경계 |
| Input border | `--input` | `#c8d3e2` | 입력·선택 필드 |
| Focus | `--ring` | `#2f6fb5` | 키보드 포커스 |
| Error | `--destructive` | `#c02626` | 오류·삭제 |
| Chart ramp | `--chart-1` … `--chart-5` | `#12467f` → `#a7cfe2` | 차트와 지역별 데이터 강도 |

### Rules

- 페이지·패널·입력·경계·강조 색상은 위 CSS 토큰만 사용한다.
- `--primary`는 선택과 실제 동작을 나타내는 곳에 사용한다.
- 지역별 강도는 `--primary`의 투명도 단계로 표현하며, 색상만으로 상태를 전달하지 않고 지역명과 건수를 항상 함께 표시한다.

## 3. Typography

### Font Stack

- Primary: `Pretendard`, `Apple SD Gothic Neo`, `Malgun Gothic`, `system-ui`, `sans-serif`
- Mono: `ui-monospace`, `SFMono-Regular`, `Menlo`, `Monaco`, `Consolas`, monospace

### Scale

| Level | Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| Page title | 18–20px | 700 | 1.4 | 사이트 제목 |
| Section title | 16px | 600–700 | 1.5 | 카드·패널 제목 |
| KPI | 24px | 700 | 1.35 | 주요 수치 |
| Body | 16px | 400 | 1.6 | 기본 본문과 입력 |
| Body/sm | 14px | 400–600 | 1.5 | 레이블, 설명, 버튼 |
| Caption | 12px | 500–600 | 1.4 | 지도 타일 보조 정보 |

한국어는 `word-break: keep-all`을 기본으로 하며 의미 단위가 어색하게 분리되지 않게 한다. 본문은 14px 아래로 내리지 않는다.

## 4. Spacing & Layout

- Base unit: 4px.
- Page width: 최대 1400px, 좌우 여백 16px(모바일) / 24px(sm 이상).
- Page rhythm: 16px(`space-y-4`).
- Panel padding: 16px.
- Card gap: 12px.
- Radius: `--radius` 8px, 입력과 버튼은 6–8px 계열을 따른다.
- Breakpoints: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px.
- 문서 전체가 세로 스크롤을 소유한다. 지도·필터·표 안에 불필요한 중첩 세로 스크롤을 만들지 않는다.
- 375px에서는 주요 콘텐츠가 한 열로 재배치되고 가로 스크롤이 생기지 않아야 한다.

## 5. Components

### Button

- **Structure**: 아이콘 선택 + 짧은 동사형 레이블.
- **Variants**: primary, outline, secondary, ghost, link, destructive.
- **States**: default, hover, focus-visible, active, disabled.
- **Accessibility**: 실제 `button`; 모든 아이콘은 장식이면 `aria-hidden`; 포커스 링은 `--ring`.
- **Motion**: 색상·그림자 전환만 사용한다.

### Form control

- **Structure**: `Label` + `Input` 또는 `NativeSelect`.
- **States**: default, focus-visible, disabled, invalid, populated.
- **Accessibility**: `htmlFor`/`id` 연결, 네이티브 키보드 조작 유지.
- **Layout**: 검색 조건은 모바일 1열, sm 2열, lg 3열 그리드. 순서는 광역시·도, 기초시·군·구, 사업 분류를 따른다.

### Data panel

- **Structure**: 의미 있는 `section` + 제목/설명 + 데이터 본문.
- **Variants**: KPI card, status panel, chart, table, map.
- **Spacing**: 12–16px 내부 여백, 12–16px 패널 간격.
- **States**: loading, ready, empty, error.
- **Depth**: 카드 표면 + 1px `--border`; 입력·팝오버에만 기존 `shadow-xs` 허용.
- **Progressive loading**: 첫 문서에서는 헤더와 패널 골격을 즉시 표시한다. 이후 100KB 이하의 전국 요약, 현재 조건의 검색 페이지, 사용자가 연 비교·CSV 데이터 순서로 불러온다. 지연 패널은 높이가 안정된 `role="status"` 표면을 사용해 레이아웃 이동을 줄인다.
- **WIKI selected-first loading**: 대시보드에서 사업을 선택해 진입하면 해당 사업 1건을 가장 먼저 조회해 상세내용을 표시한다. 왼쪽 WIKI 목록은 상세내용이 준비된 뒤 30건 단위로 지연 조회하며, WIKI 화면에서 전국 전체 데이터 파일을 내려받지 않는다. 사용자가 검색어를 입력하면 해당 검색 페이지를 우선 갱신한다.

### Regional status map

- **Structure**: 제목·설명, 화면 왼쪽 상단의 16개 광역단위 선택 목록, 실제 대한민국 행정경계를 따르는 17개 SVG 경로, 16개 통계 단위(광주·전남은 한 단위), 데이터 강도 범례, 상위 지역 요약.
- **States**: loading/zero, default, hover, focus-visible, selected.
- **Accessibility**: 선택 목록은 최소 44px 터치 영역을 가진 실제 `button` 16개로 제공한다. 각 SVG 지역 그룹도 키보드 포커스가 가능한 `role="button"`이며, 두 조작면 모두 전체 명칭과 사업 건수를 접근성 이름으로 제공하고 `aria-pressed`로 선택 상태를 표현한다.
- **Interaction**: 포인터 또는 키보드 포커스가 위치한 지역은 `--care-blue`로 강조하고 나머지 지역은 낮은 불투명도로 후퇴시킨다. 바로선택 버튼도 호버 시 `--care-blue` 표면과 흰색 텍스트를 사용한다. 선택 목록과 지도에서 선택된 지역은 포인터·포커스 상태와 관계없이 같은 파란색 채움을 유지한다. 장식 레이어는 `pointer-events: none`으로 조작면을 가리지 않는다. 두 조작면 모두 기존 시·도 필터를 갱신하고 시·군·구 선택을 비운다. 선택된 지역을 다시 누르면 전국 상태로 돌아간다.
- **Layout**: 선택 목록은 왼쪽 지도 열의 맨 위에 배치하고 375px에서는 4열, 768px 이상에서는 8열로 재배치한다. 모바일은 지도와 요약을 세로 배치하고, lg 이상에서는 유동형 본문 + 좁은 요약의 sidebar 패턴을 쓴다. 지도는 자체 가로 스크롤 없이 축소된다.

### Tabs and data table

- **States**: default, hover, focus-visible, active, empty.
- **Accessibility**: Radix 탭의 역할·키보드 동작을 유지하고 표 머리글과 페이지 조작에 명확한 레이블을 둔다.

## 6. Motion & Interaction

- Micro: 150ms ease-out, 버튼과 지도 경로의 채움·외곽선·그림자·불투명도 변화.
- Standard: 200–300ms ease-in-out, 시트·탭 전환.
- 상단 지도 또는 바로선택으로 지역을 고르면 `공식자료 현행화` 패널을 화면 상단에 맞춰 부드럽게 이동한다. `prefers-reduced-motion`에서는 즉시 이동한다.
- 애니메이션은 상태와 조작 가능성을 설명할 때만 사용한다.
- `prefers-reduced-motion` 환경에서는 지도 경로를 포함한 비필수 전환을 제거한다.

## 7. Depth & Surface

전략은 **mixed, border-led**다. 기본 계층은 배경의 톤 차이와 1px 경계로 만든다. 작은 입력과 활성 탭에는 기존의 매우 얕은 그림자만 허용한다. 새 데이터 패널과 지도 타일에는 큰 그림자나 유리 효과를 추가하지 않는다.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- WCAG 2.2 AA를 목표로 하며 본문 대비 4.5:1, 큰 텍스트·UI 경계 3:1 이상을 유지한다.
- 모든 조작 요소는 키보드로 접근 가능하고 포커스가 명확해야 한다.
- 지역 현황은 색상 외에 지역명과 숫자로도 전달한다.
- 한국어 레이블은 잘리거나 한 글자만 고립되지 않아야 한다.
- 375px, 768px, 1280px에서 주요 정보와 조작이 가려지지 않아야 한다.

### Accepted Debt

현재 승인된 접근성 부채는 없다.
