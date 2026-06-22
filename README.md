# AI Proposal Builder

전시/브랜드 체험관 제안서를 자동으로 생성하는 Next.js MVP입니다. 사용자가 RFP 또는 프로젝트 브리프를 입력하면 OpenAI API로 내용을 분석하고, 선택한 제안서 유형에 맞는 슬라이드 아웃라인과 장표별 문안을 생성한 뒤 PPTX 파일로 다운로드할 수 있습니다.

## 주요 기능

- **Home 화면**: 서비스 소개와 “새 제안서 만들기” 진입 버튼
- **프로젝트 생성**: 제안서 유형, 프로젝트명, 클라이언트명, RFP/브리프 텍스트 입력
- **RFP / 전달자료 업로드**: PDF, DOCX, TXT, MD 파일에서 텍스트를 추출해 RFP/브리프 입력창에 자동 반영
- **AI 분석 결과**: RFP를 기반으로 프로젝트 개요, 클라이언트 과제, 필수 항목, 제약 조건, 타깃, 공간/콘텐츠 조건, 누락 정보를 JSON 구조로 생성
- **제안서 구조 생성**: 기본 제안형, 브랜드 경험형, 경험 마케팅형, 기술/제품 쇼케이스형 등 중립적 제안 구조 유형에 맞춘 8~12장 슬라이드 아웃라인 생성
- **장표별 문안 생성**: 슬라이드별 제목, 부제, 본문 bullet, 이미지 placeholder, 다이어그램 제안 생성
- **PPTX 다운로드**: 16:9 와이드, 흰 배경, 검정 텍스트, 블루 포인트 컬러, 회색 이미지 placeholder 디자인 적용
- **로컬 상태 저장**: 브라우저 `localStorage`에 생성 상태를 저장해 새로고침 후에도 작업 이어가기 가능
- **보안 API Route**: OpenAI API Key는 서버 API route에서만 사용되며 클라이언트 번들에 노출되지 않음

## 파일 업로드 기능

프로젝트 생성 화면의 **RFP / 전달자료 업로드** 영역에서 RFP, 클라이언트 브리프, 전달자료 파일을 업로드할 수 있습니다.

- **지원 형식**: PDF, DOCX, TXT, MD
- TXT/MD는 브라우저에서 `File.text()`로 바로 텍스트를 읽고, PDF/DOCX는 서버 API route에서 파일 형식별 전용 로직으로 메모리 기반 텍스트만 추출합니다.
- 업로드 파일 원본은 서버에 저장하지 않으며, 텍스트 추출 처리 후 폐기됩니다.
- 스캔 PDF 또는 이미지 중심 PDF는 1차 버전에서 지원하지 않습니다. 텍스트를 추출할 수 없는 경우 내용을 직접 입력해야 합니다.
- PDF/DOCX를 일반 텍스트처럼 읽어 깨진 바이너리 문자열을 입력창에 넣지 않도록, 추출 텍스트의 제어문자/깨진 문자/바이너리 시그니처를 검사합니다.
- 추출된 텍스트가 100자 미만이거나 유효성 검사를 통과하지 못하면 자동 반영하지 않고, 사용자가 직접 입력하도록 안내합니다.
- 추출된 텍스트는 기존 RFP/브리프 입력창에 반영되며, 사용자가 내용을 확인/수정하거나 추가 메모를 이어 작성한 뒤 AI 분석을 진행할 수 있습니다.
- 파일 크기는 최대 10MB까지 지원합니다.

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

- `OPENAI_API_KEY`: 필수입니다. 서버 API route에서만 사용되며, 브라우저 번들에 노출되지 않습니다.

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
npm run typecheck
npm run build
```

## Vercel 배포 방법

1. GitHub 저장소를 Vercel 프로젝트로 Import합니다.
2. Vercel의 **Project Settings → Environment Variables**에서 `OPENAI_API_KEY`를 추가합니다.
3. Production, Preview, Development 환경에 필요한 범위를 선택한 뒤 저장합니다.
4. 기본 빌드 명령어는 `npm run build`를 사용합니다.
5. 배포 후에는 브라우저 개발자 도구에서 OpenAI API Key가 노출되지 않는지 확인하고, API route 호출이 정상 동작하는지 점검합니다.

### Vercel 배포 주의사항

- `OPENAI_API_KEY`는 클라이언트 컴포넌트 또는 `NEXT_PUBLIC_` 환경 변수로 전달하지 마세요.
- `.env.local`은 로컬 개발 전용이며 저장소에 커밋하지 마세요.
- API Key를 변경한 경우 Vercel에서 재배포해야 서버 런타임에 새 값이 반영됩니다.
- OpenAI API 사용량과 과금 한도를 배포 전에 확인하세요.

## 사용 흐름

1. Home 화면에서 **새 제안서 만들기**를 클릭합니다.
2. 제안서 유형을 선택합니다.
   - 기본형
   - 브랜드 경험형
   - 경험 마케팅형
   - 기술/제품 쇼케이스형
3. 프로젝트명, 클라이언트명을 입력하고, RFP/브리프 텍스트를 직접 입력하거나 RFP/전달자료 파일을 업로드합니다.
4. **AI로 분석하기**를 클릭해 분석 결과를 생성합니다.
5. **제안서 구조 생성**을 클릭해 슬라이드 아웃라인을 생성합니다.
6. **장표별 문안 생성**을 클릭해 슬라이드별 문안을 생성합니다.
7. **PPTX 다운로드**를 클릭해 `.pptx` 파일을 저장합니다.

## 프로젝트 구조

```text
app/
  api/
    analyze/route.ts   # RFP/브리프 분석 API
    extract-text/route.ts # PDF/DOCX 텍스트 추출 API
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

OpenAI API Key는 `.env.local`에만 저장하세요. `.env.local`은 `.gitignore`에 포함되어 있으므로 저장소에 커밋되지 않습니다. 클라이언트는 `/api/analyze`, `/api/outline`, `/api/slides` API route만 호출하고, 실제 OpenAI API 호출은 서버에서 수행됩니다.

## Optional Supabase RAG database foundation

Persistent RAG storage is optional and currently foundation-only. See [`docs/database.md`](docs/database.md) for the required Supabase environment variables and instructions for applying `supabase/schema.sql`.
