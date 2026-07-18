# Phase 1 — 소셜 로그인 & 유저 정체성 확립

## Context

텔레그램 Webhook 기반 AI 패션 추천 챗봇을 자체 iOS 앱으로 전환한다.
현재 유저 식별자는 `hash(chat_id)` (Telegram 종속) 이며, 소비자 유저 테이블·소셜 인증 레이어·채팅 REST API가 모두 없는 상태다.
이 계획은 소셜 로그인(Google/Apple) → ai-server JWT 발급 → 채팅 API 노출까지 서버 사이드 전체를 다룬다.
프론트(iOS UI)는 스코프 외.

---

## Architecture

```
iOS App
  └─ 1. Google/Apple SDK → id_token
  └─ 2. POST /auth/social  →  ai-server
                                └─ verify id_token (Google OIDC / Apple JWKS)
                                └─ upsert ai.user_profiles
                                └─ issue access_token (1h) + refresh_token (30d)
  └─ 3. POST /chat  →  ai-server (Bearer access_token)
                         └─ JWT middleware → user_id
                         └─ LangGraph 기존 로직 재사용
                         └─ ai.chat_sessions / ai.chat_messages 저장
```

---

## 작업 범위 (3 Phase)

### Phase 1-A: DB 마이그레이션 (ai-server Alembic)

**파일**: `ai-server/alembic/versions/` 에 새 revision 추가

**신규 테이블 (ai schema):**

```sql
-- ai.user_profiles
user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid()
provider      TEXT NOT NULL  -- 'google' | 'apple' | 'telegram'
provider_id   TEXT NOT NULL  -- sub claim from id_token
email         TEXT
display_name  TEXT
avatar_url    TEXT
gender        TEXT           -- 'male' | 'female' | 'other' | NULL (선택)
tier          TEXT NOT NULL DEFAULT 'free'  -- 'free' | 'basic' | 'pro' | 'premium'
tier_expires_at TIMESTAMPTZ                 -- NULL = 무제한(free) or 유료 만료일
created_at    TIMESTAMPTZ DEFAULT now()
updated_at    TIMESTAMPTZ DEFAULT now()
UNIQUE (provider, provider_id)
-- CHECK (tier IN ('free','basic','pro','premium'))
-- CHECK (gender IS NULL OR gender IN ('male','female','other'))

-- ai.refresh_tokens
token_id      UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id       UUID NOT NULL REFERENCES ai.user_profiles(user_id) ON DELETE CASCADE
token_hash    TEXT NOT NULL UNIQUE   -- SHA-256 of raw token
expires_at    TIMESTAMPTZ NOT NULL
revoked_at    TIMESTAMPTZ
created_at    TIMESTAMPTZ DEFAULT now()

-- ai.chat_sessions
session_id    UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id       UUID NOT NULL REFERENCES ai.user_profiles(user_id)
title         TEXT                   -- 첫 메시지 자동 생성
created_at    TIMESTAMPTZ DEFAULT now()
last_message_at TIMESTAMPTZ

-- ai.chat_messages
message_id    UUID PRIMARY KEY DEFAULT gen_random_uuid()
session_id    UUID NOT NULL REFERENCES ai.chat_sessions(session_id)
role          TEXT NOT NULL          -- 'user' | 'assistant'
content       TEXT NOT NULL
product_refs  JSONB                  -- [{product_id, reason}] 추천 상품 참조
created_at    TIMESTAMPTZ DEFAULT now()
```

**기존 테이블 변경:**
- `ai.user_session.user_key` 컬럼에 `user_id UUID REFERENCES ai.user_profiles` 컬럼 추가 (nullable, 점진 마이그레이션)
- `ai.user_taste_profile` 동일 패턴

---

### Phase 1-B: Social Auth 레이어 (ai-server/app/)

#### 신규 파일

**`app/core/social_auth/google.py`**
- `google-auth` 라이브러리 (`pip install google-auth`)
- `id_token.verify_oauth2_token(token, Request(), GOOGLE_CLIENT_ID)`
- 반환: `{sub, email, name, picture}`

**`app/core/social_auth/apple.py`**
- Apple JWKS endpoint (`https://appleid.apple.com/auth/keys`) 에서 공개키 조회
- `python-jose[cryptography]` 로 JWT 검증
- `aud` = iOS Bundle ID, `iss` = `https://appleid.apple.com`
- 반환: `{sub, email}` (Apple은 최초 1회만 email 제공)

**`app/core/jwt.py`**
- `python-jose` HS256 사용 (단일 서버, 대칭키)
- `create_access_token(user_id, expire=60min)` → `{user_id, type:"access", exp}`
- `create_refresh_token(user_id, expire=30d)` → `{user_id, type:"refresh", exp}`
- `verify_token(token)` → payload or raise 401
- refresh token은 DB에 hash 저장 (revocation 지원)

**`app/api/auth.py`** (FastAPI router, prefix `/auth`)
```
POST /auth/social
  body: {provider: "google"|"apple", id_token: str}
  → verify id_token → upsert user_profiles → issue JWT pair
  → 200 {access_token, refresh_token, user_id}

POST /auth/refresh
  body: {refresh_token: str}
  → verify + DB lookup → issue new access_token
  → 200 {access_token}

POST /auth/revoke
  header: Authorization: Bearer <access_token>
  → mark refresh_token revoked in DB
  → 204
```

**`app/core/dependencies.py`** (FastAPI Depends)
- `get_current_user(token: str = Depends(oauth2_scheme))` → `user_id: UUID`
- 기존 `verify_internal_token` 는 유지 (Next.js 어드민 호출용)

#### 수정 파일

**`app/core/config.py`**
- 추가 env vars:
  ```
  GOOGLE_CLIENT_ID
  APPLE_CLIENT_ID          # iOS Bundle ID or Service ID
  JWT_SECRET               # 32+ chars random string
  JWT_ALGORITHM = "HS256"
  ACCESS_TOKEN_EXPIRE_MINUTES = 60
  REFRESH_TOKEN_EXPIRE_DAYS = 30
  ```

**`app/main.py`**
- `app.include_router(auth_router)`
- `app.include_router(chat_router)`  (Phase 1-C)

#### 신규 의존성 (`pyproject.toml`)
```
google-auth>=2.29
python-jose[cryptography]>=3.3
```

---

### Phase 1-C: Consumer Chat API (ai-server/app/)

**`app/api/chat.py`** (FastAPI router, prefix `/chat`)
```
POST /chat/sessions
  auth: Bearer
  body: {message: str}
  → create session → invoke LangGraph (기존 로직 재사용)
  → store in chat_messages → 200 {session_id, reply, products}

POST /chat/sessions/{session_id}/messages
  auth: Bearer
  body: {message: str}
  → verify session ownership → invoke LangGraph
  → append messages → 200 {reply, products}

GET /chat/sessions
  auth: Bearer
  → list sessions for user → 200 [{session_id, title, last_message_at}]

GET /chat/sessions/{session_id}/messages
  auth: Bearer
  → paginated message list → 200 {messages, next_cursor}
```

**LangGraph 연결 전략:**
- 기존 `app/api/webhooks/telegram.py` 의 graph invoke 로직을 `app/services/chat_service.py` 로 추출
- Telegram handler + consumer chat API 둘 다 `chat_service.invoke(user_id, message)` 호출
- Telegram handler는 Phase 1 이후에도 유지 (점진 전환)

---

## 파일 변경 목록

| 파일 | 작업 | 비고 |
|------|------|------|
| `alembic/versions/XXX_user_auth.py` | 신규 | 4개 테이블 생성 |
| `app/core/social_auth/google.py` | 신규 | google-auth 검증 |
| `app/core/social_auth/apple.py` | 신규 | JWKS 검증 |
| `app/core/jwt.py` | 신규 | token 발급/검증 |
| `app/core/dependencies.py` | 신규 or 수정 | FastAPI Depends |
| `app/core/config.py` | 수정 | 5개 env var 추가 |
| `app/api/auth.py` | 신규 | 3개 엔드포인트 |
| `app/services/chat_service.py` | 신규 | LangGraph 로직 추출 |
| `app/api/chat.py` | 신규 | 4개 엔드포인트 |
| `app/api/webhooks/telegram.py` | 수정 | chat_service 호출로 교체 |
| `app/main.py` | 수정 | 라우터 등록 |
| `pyproject.toml` | 수정 | 2개 의존성 추가 |

**kiko.ai-app (Next.js)**: 이번 Phase 변경 없음.
**crawler**: 변경 없음.

---

## 검증 방법

```bash
# 1. 마이그레이션
cd ai-server && alembic upgrade head

# 2. 서버 기동
uvicorn app.main:app --reload

# 3. Google 소셜 로그인 테스트 (테스트 id_token 필요)
curl -X POST http://localhost:8000/auth/social \
  -H "Content-Type: application/json" \
  -d '{"provider":"google","id_token":"<REAL_GOOGLE_IDTOKEN>"}'

# 4. 채팅 API 테스트
curl -X POST http://localhost:8000/chat/sessions \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"오늘 입을 캐주얼 코디 추천해줘"}'

# 5. 기존 Telegram 흐름 회귀 테스트 (변경 후에도 동작해야 함)
# → Telegram webhook 시뮬레이터로 메시지 전송 후 응답 확인
```

---

## 작업 순서 (의존성 기준)

1. DB 마이그레이션 (Phase 1-A) — 모든 것의 기반
2. JWT + Social Auth 검증 모듈 (Phase 1-B) — DB 테이블에 의존
3. Auth API 엔드포인트 (Phase 1-B) — JWT 모듈에 의존
4. chat_service 추출 → Chat API (Phase 1-C) — Auth 미들웨어에 의존

병렬 가능: google.py / apple.py / jwt.py 는 동시 작업 가능.

---

## 미결 사항 (구현 시 확인 필요)

- Apple Sign In은 최초 로그인 시만 email 제공 → `email NULL` 허용 필수
- iOS Bundle ID (`APPLE_CLIENT_ID`) 값은 Xcode 프로젝트 설정에서 확인 필요
- `GOOGLE_CLIENT_ID` 는 Google Cloud Console > OAuth 2.0 클라이언트 ID (iOS 타입) 확인 필요
- Redis 채팅 상태 캐시(SPEC-CHAT-STATE-REDIS-001)와 새 chat_messages DB 저장의 중복 정책 결정 필요
