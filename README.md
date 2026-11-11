# 살아있는 파리 (Paris vivant)

실제 파리 지도 위에서 시민과 관광객 수천 명이 하루 일과에 따라 걷고 메트로를 타는 모습을 보여주는 브라우저 시뮬레이션입니다.

- **지도**: 20개 구, 센강·운하, 공원·숲, 도로 약 2만 4천 구간 (파리시 오픈데이터)
- **랜드마크**: 에펠탑, 노트르담, 개선문 등 26곳을 평면 지도 위에 3D 모델로 표시 (축소하면 아이콘처럼 커지고, 확대하면 실제 크기)
- **3D 뷰어**: 에펠탑을 클릭하면 전체 화면 3D 뷰어가 열립니다 (회전·확대·이동). `public/models/`에 가우시안 스플랫 파일(`eiffel.spz` 등)이 있으면 촬영 장면을, 없으면 `eiffel.glb` 모델을 보여줍니다. GLB 모드는 낮/밤 전환, 기본 황금빛 조명, 버튼으로 재생하는 30초 반짝임 미리보기를 제공합니다. 조건은 `public/models/README.md` 참고.
- **루브르 3D**: 지도에서 루브르 박물관을 클릭하면 유리 피라미드와 분수, 궁전 날개와 파빌리온, 쿠르 카레, 카루젤 개선문과 정원을 3D로 볼 수 있습니다 (외부만, 낮/밤, 걸어서 보기 지원). 모델은 `npm run model:louvre`로 생성합니다.
- **개선문 3D**: 지도에서 개선문(`Arc de Triomphe`)을 클릭하면 높이 50 m의 개선문(4대 고부조 조각군, 30개 방패 애틱, 장미 격자 아치 천장, 중앙 아치 아래 무명용사의 묘와 일렁이는 '꺼지지 않는 불꽃'), 직경 240 m의 샤를 드골(에투알) 원형 광장, 샹젤리제·그랑드아르메·포슈 등 12개 방사형 대로와 주변 오스만/마레쇼 건축군을 3D로 둘러볼 수 있습니다. 걸어서 보기 모드에서는 아치 아래를 통과하거나 남동쪽 교각 내부 계단을 통해 49.5 m 옥상 전망대 테라스까지 직접 올라갈 수 있습니다 (`npm run model:arc`).
- **노트르담 3D**: 지도에서 `Notre-Dame`을 클릭하면 길이 128 m의 대성당을 3D로 볼 수 있습니다. 서쪽 정면(세 정문과 팀파눔 부조, 28왕의 갤러리, 지름 9.6 m 장미창, 열주 갤러리, 69 m 쌍탑과 종루 미늘창), 네이브·성가대·후진을 두른 플라잉 버트레스와 첨두 창, 남북 트랜셉트의 대형 장미창, 납 지붕과 96 m 첨탑(구리 사도상 16개, 꼭대기 수탉), 성구실, 광장의 샤를마뉴 기마상을 담았습니다. 주변은 시테섬 동쪽 절반으로, 센강 두 갈래와 다리 여섯 개, 파르비 광장, 장 23세 광장 정원, 생루이섬과 양쪽 강변입니다. 밤에는 투광 조명이 켜지고 스테인드글라스가 제 색으로 빛납니다. 걸어서 보기로 섬과 다리를 돌아볼 수 있습니다(외부만). 형태는 Higgsfield 3D Jutsu(호스팅 Blender)에서 미터 단위로 모델링했고, 장미창·랜싯창·팀파눔·문·석재·납 지붕 텍스처는 Higgsfield 이미지 생성(GPT Image 2.6)으로 만들었습니다 (`npm run model:notredame`).
- **걸어서 보기**: 3D 뷰어에서 "걸어서 보기"를 누르면 1인칭 시점으로 에펠탑 주변을 걸어 다닙니다. W/A/S/D(또는 방향키)로 이동, 마우스로 시야 회전, Shift로 달리기, Space로 점프, Esc로 나가기. 화면을 클릭하면 마우스가 화면에 고정됩니다.
- **화질**: 기본은 자동입니다. 화면 크기·기기 정보와 지속적인 프레임 속도에 맞춰 해상도·그림자·후처리·세부 철골을 조절합니다. 높음/균형/절약을 직접 선택할 수도 있고 선택은 다음 실행에 유지됩니다.
- **주변 거리**: 차로·보도·횡단보도와 신호등을 표시하고, 입체 보행자와 차량이 이동합니다. 차는 앞차와 간격을 유지하며 신호와 횡단 중인 사람을 기다립니다. ‘거리 보기’로 가까이 보고 ‘주변 이동’으로 움직임을 멈출 수 있습니다. 높음/균형/절약 화질에서 각각 160/112/56명과 차량 32/24/12대를 표시합니다.
- **메트로**: 16개 노선, 322개 역. 7·13호선의 분기와 7bis·10호선의 순환 구간 포함 (IDFM 오픈데이터)
- **사람**: 주민은 출근 → 퇴근 → (여가) → 귀가, 관광객은 명소를 2~4곳 돌아봅니다. 이동할 때마다 도보와 메트로(환승 포함) 중 빠른 쪽을 고릅니다.
- **사건**: 노선 버튼을 누르면 해당 노선이 파업으로 멈추고, 승객들이 다른 경로를 찾습니다. "비 오는 날"을 켜면 걷기를 꺼려 메트로로 몰립니다.

## 실행

```bash
npm install
```

```bash
npm run dev
```

브라우저에서 표시된 주소(기본 http://localhost:5173)를 엽니다.

| 조작 | 동작 |
|---|---|
| 드래그 / 휠 / 핀치 | 지도 이동·확대 |
| 스페이스 | 일시정지 / 재개 |
| 역·열차·명소에 마우스 올리기 | 대기 승객, 열차 행선지 등 정보 |
| 노선 버튼 | 운행 중단 / 재개 |
| 에펠탑 클릭 | 전체 화면 3D 보기 |
| 3D 보기의 Escape / 닫기 | 로딩 중에도 닫고 지도로 복귀 |
| 3D 보기의 거리 보기 | 도로 근접 시점 / 이전 시점 전환 |
| 3D 보기의 주변 이동 | 사람·차량과 신호 시계 일시정지 / 재개 |

## 명령

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입 검사 후 `dist/`에 빌드 |
| `npm test` | 시뮬레이션·주변 교통 회귀 검사와 압축 모델 구조 검사 |
| `npm run test:browser` | 뷰어 로딩 취소·자원 해제·조명·화질·모바일·스플랫 검사 |
| `npm run model:eiffel` | 에펠탑 GLB 재생성 및 Meshopt 압축 |
| `npm run model:louvre` | 루브르 박물관 GLB 재생성 및 Meshopt 압축 |
| `npm run model:arc` | 개선문 및 에투알 광장 GLB 재생성 및 Meshopt 압축 |
| `npm run model:notredame` | 노트르담 GLB 재생성 (Higgsfield 3D Jutsu 내보내기를 재료별로 병합·Meshopt 압축) |
| `npm run data:fetch` | 원본 오픈데이터를 `data/raw/`에 내려받기 |
| `npm run data:build` | 원본 데이터를 `public/data/paris.json`으로 가공 |

가공된 `public/data/paris.json`이 저장소에 들어 있으므로 평소에는 데이터 명령을 실행할 필요가 없습니다.

브라우저 테스트를 처음 실행할 때는 `npx playwright install chromium`으로 테스트용 브라우저를 설치합니다. 설치된 Google Chrome을 사용하려면 `PLAYWRIGHT_CHANNEL=chrome npm run test:browser`를 실행합니다.

## 구조

| 파일 | 역할 |
|---|---|
| `scripts/fetch-data.mjs`, `scripts/build-data.mjs` | 데이터 내려받기와 가공 (좌표를 미터 단위로 변환, 도로 그래프·메트로 노선 구성) |
| `src/roads.ts` | 도로 그래프와 보행 경로 탐색 (A*) |
| `src/metro.ts` | 열차 운행, 승하차, 메트로 경로 탐색 |
| `src/sim.ts` | 사람(에이전트)의 하루 일정과 이동 |
| `src/landmarks.ts` | 랜드마크 3D 모델 (직접 만든 도형 조합, 사투영) |
| `src/render.ts` | 캔버스 지도 렌더링 |
| `src/viewer.ts`, `src/viewer-registry.ts` | 랜드마크 3D 뷰어 (Three.js, 클릭 시에만 로드)와 뷰어 대상 목록 |
| `src/viewer-quality.ts`, `src/viewer-resources.ts` | 자동·수동 화질 정책과 GPU 자원 정리 |
| `src/viewer-city.ts`, `src/viewer-streets.ts` | 도시 배경, 도로·보도와 보행자·차량의 인스턴스 렌더링 |
| `src/street-motion.ts` | 주변 거리의 경로·신호·대기·차량 간격 유지 (고정 시간 간격) |
| `scripts/build-louvre-glb.mjs`, `src/viewer-louvre.ts` | 루브르 모델 생성기(미터 단위, 피라미드가 원점)와 주변 환경·야간 조명. 랜드마크별 설정은 `src/viewer-registry.ts`의 `site` |
| `scripts/build-arc-glb.mjs`, `src/viewer-arc.ts` | 개선문·샤를 드골(에투알) 광장·12개 방사형 대로 모델 생성기와 주변 파리 시가지·꺼지지 않는 불꽃·야간 조명 |
| `src/walk-world.ts`, `src/viewer-walk.ts` | 걸어서 보기: 지면 높이·충돌 계산(격자 기반)과 키보드·마우스·카메라 연결 |
| `src/viewer-splat.ts`, `src/viewer-splat-run.ts` | 뷰어의 실사 모드: 가우시안 스플랫 파일 탐색과 렌더링 (Spark, 파일이 있을 때만 로드) |
| `src/main.ts` | 화면 구성과 조작 |

## 모델의 단순화

- 이동 수단은 도보와 메트로뿐입니다 (버스, RER, 트램, 자전거, 자동차 없음).
- 인구는 실제의 일부만 표본으로 시뮬레이션하며, 열차 정원도 그에 비례해 줄였습니다.
- 집·직장 위치는 도로망 위에서 무작위로 뽑되, 직장은 업무 지구 쪽으로 치우치게 했습니다. 실제 인구·고용 통계는 반영하지 않았습니다.
- 시 경계 밖의 역은 열차가 지나가지만 걸어서 접근할 수 없습니다 (도로 데이터가 파리 시내만 포함).
- 에펠탑은 공개된 층 높이와 열린 1층 구조를 참고해 코드로 만든 모델입니다. 동·서 정원, 두 연못, 샹드마르스와 주변 건물은 현장 배치를 참고한 근사 표현이며 측량·사진 스캔 데이터는 아닙니다.
- 3D 주변 거리는 별도의 연출용 시뮬레이션입니다. 경로와 신호 주기는 실제 도로망·신호 운영을 복제한 것이 아니며 지도 속 에이전트와 연동되지 않습니다. 보행 중심 계획을 참고해 탑 광장과 다리에는 일반 차량을 배치하지 않았습니다. 동작 줄이기 설정을 사용하는 기기에서는 주변 이동을 기본으로 멈춥니다.

## 에펠탑 모델 참고 자료

- [공식 1층 안내](https://www.toureiffel.paris/en/explore/first-floor): 중앙이 열린 층 구조와 유리 바닥
- [공식 정원 안내](https://www.toureiffel.paris/en/explore/gardens): 동·서 정원과 두 연못
- [공식 조명 안내](https://www.toureiffel.paris/en/the-monument/lights): 황금빛 구조 조명과 반짝임을 분리한 표현
- [공식 주요 수치](https://www.toureiffel.paris/en/the-monument/key-figures): 탑과 전망층의 높이
- [파리시 Trocadéro–Iéna 정비 계획](https://www.paris.fr/pages/plus-vert-plus-pieton-et-apaise-le-secteur-trocadero-iena-va-se-reinventer-26586): 보행 중심 다리·광장 배치의 참고 자료
- [공식 접근성 안내](https://www.toureiffel.paris/fr/registre-accessibilite-2025): 정원과 출입구 동선의 참고 자료

## 데이터 출처

- 구 경계, 도로, 수면, 녹지 © Ville de Paris ([opendata.paris.fr](https://opendata.paris.fr)), ODbL
- 메트로 노선과 역 © Île-de-France Mobilités ([data.iledefrance-mobilites.fr](https://data.iledefrance-mobilites.fr)), Licence Ouverte v2.0
