# AI Proposal Builder

전시/브랜드 체험관 제안서를 자동으로 생성하는 Next.js MVP입니다. 사용자가 RFP 또는 프로젝트 브리프를 입력하면 OpenAI API로 내용을 분석하고, 선택한 제안서 유형에 맞는 슬라이드 아웃라인과 장표별 문안을 생성한 뒤 PPTX 파일로 다운로드할 수 있습니다.

## 주요 기능

- **Home 화면**: 서비스 소개와 “새 제안서 만들기” 진입 버튼
- **프로젝트 생성**: 제안서 유형, 프로젝트명, 클라이언트명, RFP/브리프 텍스트 입력
- **AI 분석 결과**: RFP를 기반으로 프로젝트 개요, 클라이언트 과제, 필수 항목, 제약 조건, 타깃, 공간/콘텐츠 조건, 누락 정보를 JSON 구조로 생성
- **제안서 구조 생성**: 기본형, 제일기획형, 이노션형, 현대차그룹형에 맞춘 8~12장 슬라이드 아웃라인 생성
- **장표별 문안 생성**: 슬라이드별 제목, 부제, 본문 bullet, 이미지 placeholder, 다이어그램 제안 생성
- **PPTX 다운로드**: 16:9 와이드, 흰 배경, 검정 텍스트, 블루 포인트 컬러, 회색 이미지 placeholder 디자인 적용
- **로컬 상태 저장**: 브라우저 `localStorage`에 생성 상태를 저장해 새로고침 후에도 작업 이어가기 가능
- **보안 API Route**: OpenAI API Key는 서버 API route에서만 사용되며 클라이언트 번들에 노출되지 않음

## 기술 스택

- Next.js App Router
- TypeScript
- Tailwind CSS
- OpenAI Node SDK
- pptxgenjs
- Browser localStorage

## 설치 방법

```bash
npm install
```

## 환경 변수 설정

`.env.example`을 복사해 `.env.local` 파일을 만들고 OpenAI API Key를 입력하세요.

```bash
cp .env.example .env.local
```

```env
OPENAI_API_KEY=your_openai_api_key_here
```

- `OPENAI_API_KEY`: 필수입니다. 서버 API route에서만 사용되며 클라이언트 번들에 노출되지 않아야 합니다.

## 실행 방법

개발 서버를 실행합니다.

```bash
npm run dev
```

브라우저에서 아래 주소로 접속합니다.

```text
http://localhost:3000
```

## 빌드 및 검증

```bash
npm run check:conflicts
npm run typecheck
npm run build
```

- `npm run check:conflicts`: PR merge 과정에서 Git conflict marker가 남아 있는지 확인합니다.


## Vercel 배포 방법

이 프로젝트는 표준 Next.js App Router 구조이므로 Vercel에서 별도 `vercel.json` 없이 자동 감지되어 빌드될 수 있습니다. `package.json`에는 Vercel이 사용하는 `build` 스크립트와 로컬 실행용 `dev`, `start` 스크립트가 포함되어 있습니다. 현재 별도 `lint` 스크립트는 두지 않았습니다.

1. GitHub repository를 Vercel에 **Import**합니다.
2. **Framework Preset**은 **Next.js**를 선택합니다.
3. **Environment Variables**에 아래 값을 등록합니다.
   - Name: `OPENAI_API_KEY`
   - Value: 발급받은 OpenAI API Key
4. **Deploy**를 클릭합니다.
5. 배포가 완료되면 Vercel이 생성한 URL에 접속해 RFP/브리프 입력, AI 분석, 아웃라인 생성, 장표 문안 생성, PPTX 다운로드 흐름을 테스트합니다.

## Vercel 배포 전 체크리스트

- `package.json` scripts
  - `dev`: `next dev`
  - `build`: `next build`
  - `start`: `next start`
  - `check:conflicts`: `node scripts/check-conflict-markers.mjs`
  - `lint`: 현재 없음
- Next.js 자동 감지 기준
  - 루트에 `package.json`이 있고 `next` 의존성이 포함되어 있습니다.
  - `app/` 디렉터리와 API route가 포함된 표준 Next.js App Router 구조입니다.
  - Vercel은 기본적으로 `npm install` 후 `npm run build`를 실행합니다.
- OpenAI API Key 보안
  - `process.env.OPENAI_API_KEY`는 `lib/openai.ts` 서버 헬퍼에서만 참조합니다.
  - 클라이언트 컴포넌트는 `/api/analyze`, `/api/outline`, `/api/slides`만 호출합니다.
  - `NEXT_PUBLIC_` 접두사가 붙은 OpenAI API Key 환경변수를 만들지 마세요.

## 주의사항

- ChatGPT Plus 구독과 OpenAI API 사용은 별개입니다. 이 앱을 배포하려면 OpenAI API Key와 API 사용량 과금 설정이 필요합니다.
- Vercel Environment Variables의 이름은 반드시 `OPENAI_API_KEY`로 입력하세요.
- API Key를 `NEXT_PUBLIC_OPENAI_API_KEY`처럼 `NEXT_PUBLIC_` 접두사로 만들지 마세요. `NEXT_PUBLIC_` 환경변수는 클라이언트에 노출될 수 있습니다.
- 실제 API Key를 `.env.example`, README, GitHub commit, PR description 등에 포함하지 마세요.
- `.env.local`은 `.gitignore`에 포함되어 있으므로 로컬에서만 사용하고 GitHub에 커밋하지 마세요.

## 사용 흐름

1. Home 화면에서 **새 제안서 만들기**를 클릭합니다.
2. 제안서 유형을 선택합니다.
   - 기본형
   - 제일기획형
   - 이노션형
   - 현대차그룹형
3. 프로젝트명, 클라이언트명, RFP/브리프 텍스트를 입력합니다.
4. **AI로 분석하기**를 클릭해 분석 결과를 생성합니다.
5. **제안서 구조 생성**을 클릭해 슬라이드 아웃라인을 생성합니다.
6. **장표별 문안 생성**을 클릭해 슬라이드별 문안을 생성합니다.
7. **PPTX 다운로드**를 클릭해 `.pptx` 파일을 저장합니다.

## 프로젝트 구조

```text
app/
  api/
    analyze/route.ts   # RFP/브리프 분석 API
    outline/route.ts   # 슬라이드 아웃라인 생성 API
    slides/route.ts    # 장표별 문안 생성 API
  globals.css          # Tailwind 및 전역 스타일
  layout.tsx           # 앱 메타데이터 및 루트 레이아웃
  page.tsx             # 전체 MVP UI와 PPTX 다운로드 로직
lib/
  openai.ts            # OpenAI 서버 클라이언트 및 JSON 생성 헬퍼
  schemas.ts           # Structured Outputs JSON Schema
  types.ts             # 앱 공용 TypeScript 타입
```

## 보안 참고

OpenAI API Key는 `.env.local` 또는 Vercel Environment Variables에만 저장하세요. `.env.local`은 `.gitignore`에 포함되어 있으므로 저장소에 커밋되지 않습니다. 클라이언트는 `/api/analyze`, `/api/outline`, `/api/slides` API route만 호출하고, 실제 OpenAI API 호출은 서버에서 수행됩니다.

## Troubleshooting

### Codex 환경에서 `npm install`이 403으로 실패하는 경우

이 저장소를 작성한 Codex 환경에서는 registry/proxy 정책 때문에 `npm install`이 scoped package 요청에서 `403 Forbidden`으로 실패한 사례가 있었습니다. 이는 프로젝트 코드 오류라기보다 해당 실행 환경의 npm registry/proxy 정책 문제일 수 있으며, 일반 로컬 PC나 Vercel 배포 환경에서는 정상 설치될 수 있습니다.

Vercel 빌드 로그에서 dependency install 오류가 발생하면 아래를 확인하세요.

1. Vercel Project Settings의 npm registry 설정이 기본 npm registry 또는 조직에서 허용한 registry를 바라보는지 확인합니다.
2. `package.json`의 dependencies/devDependencies 이름과 버전 범위가 올바른지 확인합니다.
3. 사내 프록시나 private registry를 사용하는 경우 Vercel 환경에서도 동일한 registry 인증 설정이 가능한지 확인합니다.
4. 설치 단계가 통과한 뒤에도 빌드가 실패하면 `OPENAI_API_KEY` 환경변수가 등록되어 있는지 확인합니다.
