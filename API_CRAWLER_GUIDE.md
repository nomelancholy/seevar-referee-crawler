# 외부 크롤러 API 사용 가이드 (External API Guide)

이 문서는 See VAR 시스템의 데이터를 외부 크롤러 또는 자동화 도구에서 동기화하기 위한 API 명세를 설명합니다.

## 1. 인증 (Authentication)

모든 API 요청은 환경변수 `CRAWLER_API_KEY`에 설정된 비밀키를 헤더에 포함해야 합니다.

- **방법 1**: `Authorization: Bearer <YOUR_API_KEY>`
- **방법 2**: `x-crawler-api-key: <YOUR_API_KEY>`

---

## 2. 정보 조회 및 매핑 API

크롤러가 작업을 수행하기 전, 대상 리그 및 라운드를 식별하거나 신규 정보를 등록하기 위해 사용합니다.

### 2.1 리그 목록 조회
- **Endpoint**: `GET /api/leagues`
- **Query Parameters**:
  - `year`: (선택) 연도 필터링
- **Response 예시**:
  ```json
  {
    "ok": true,
    "leagues": [
      { "id": "league-cuid-1", "name": "K League 1", "slug": "kleague1", "year": 2026 },
      { "id": "league-cuid-2", "name": "K League 2", "slug": "kleague2", "year": 2026 }
    ]
  }
  ```

### 2.2 경기 일정 조회
- **Endpoint**: `GET /api/schedule`
- **Query Parameters**:
  - `year`: 시즌 연도 (예: `2026`)
  - `league`: 리그 Slug (예: `kleague1`, `kleague2`)
- **Response 예시**:
  ```json
  {
    "ok": true,
    "count": 1,
    "matches": [
      {
        "id": "cm1234567890",
        "year": 2026,
        "leagueSlug": "kleague1",
        "homeTeamName": "울산 HD FC",
        "awayTeamName": "전북 현대 모터스",
        "playedAt": "2026-03-01T05:00:00.000Z",
        "status": "SCHEDULED",
        "scoreHome": 0,
        "scoreAway": 0
      }
    ]
  }
  ```

### 2.3 라운드 조회 및 생성
- **조회 Endpoint**: `GET /api/rounds`
- **Query Parameters**:
  - `leagueId`: (필수) 리그 ID
  - `number`: (선택) 라운드 번호
- **Response 예시**:
  ```json
  {
    "ok": true,
    "rounds": [
      { "id": "round-cuid-5", "number": 5, "slug": "round-5" }
    ]
  }
  ```

- **생성 Endpoint**: `POST /api/rounds`
- **Request Body**:
  ```json
  {
    "leagueId": "league-id-here",
    "number": 5,
    "slug": "round-5"
  }
  ```
- **설명**: 크롤러가 작업하려는 라운드가 위 조회 API나 `GET /api/schedule`에서 확인되지 않을 경우 직접 생성합니다.

### 2.4 심판 검색
- **Endpoint**: `GET /api/referees/search`
- **Query Parameters**:
  - `name`: 검색할 심판 이름
- **Response 예시**:
  ```json
  {
    "ok": true,
    "referees": [
      {
        "id": "ref-cuid-123",
        "name": "김우성",
        "slug": "kim-useong",
        "link": "https://namu.wiki/w/..."
      }
    ]
  }
  ```

### 2.5 팀 검색
- **Endpoint**: `GET /api/teams/search`
- **Query Parameters**:
  - `name`: 검색할 팀 이름
- **Response 예시**:
  ```json
  {
    "ok": true,
    "teams": [
      {
        "id": "team-cuid-456",
        "name": "FC 서울",
        "slug": "fc-seoul",
        "emblemPath": "/images/emblems/seoul.png"
      }
    ]
  }
  ```

### 2.6 신규 심판 등록
- **Endpoint**: `POST /api/referees`
- **Request Body**:
  ```json
  {
    "name": "홍길동",
    "link": "https://namu.wiki/..."
  }
  ```
- **Response 예시**:
  ```json
  {
    "ok": true,
    "referee": {
      "id": "ref-new-789",
      "name": "홍길동",
      "slug": "hong-gildong",
      "link": "https://namu.wiki/..."
    }
  }
  ```

---

## 3. 라운드 및 경기 상태 관리 API

### 3.1 포커스 라운드 변경
- **Endpoint**: `POST /api/rounds/focus`
- **Request Body** (ID 기반):
  ```json
  { "roundId": "clx12345..." }
  ```
- **Response 예시**:
  ```json
  {
    "ok": true,
    "message": "Round clx12345... is now the focus round."
  }
  ```

### 3.2 경기 상태 업데이트
- **Endpoint**: `PATCH /api/matches/{matchId}/status`
- **Request Body**:
  ```json
  { "status": "LIVE" } 
  ```
- **Response 예시**:
  ```json
  {
    "ok": true,
    "match": {
      "id": "cm12345...",
      "status": "LIVE",
      "updatedAt": "2026-04-12T10:00:00Z"
    }
  }
  ```

### 3.3 경기 상세 일정 수정
- **Endpoint**: `PATCH /api/matches/{matchId}/schedule`
- **Request Body**:
  ```json
  {
    "playedAt": "2026-03-01T14:00:00+09:00",
    "venue": "울산문수축구경기장"
  }
  ```
- **설명**: 기존 경기의 일시나 경기장 정보를 수정합니다. 연맹의 일시 변경 대응 시 사용합니다.

### 3.4 신규 경기 생성
- **Endpoint**: `POST /api/matches`
- **Request Body**:
  ```json
  {
    "roundId": "clx12345...",
    "homeTeamId": "team-id-1",
    "awayTeamId": "team-id-2",
    "playedAt": "2026-03-01T14:00:00+09:00",
    "venue": "울산문수축구경기장",
    "roundOrder": 1
  }
  ```
- **설명**: 관리자가 등록하지 않은 경기를 새로 생성합니다. `roundOrder`를 생략하면 라운드의 마지막 순번 다음으로 자동 지정됩니다.
- **Response 예시**:
  ```json
  {
    "ok": true,
    "match": { "id": "new-match-id", ... }
  }
  ```

---

## 4. 경기 상세 데이터 동기화 API

### 4.1 심판 배정
- **Endpoint**: `POST /api/matches/{matchId}/referees`
- **Request Body**:
  ```json
  {
    "referees": [
      { "id": "ref-id-1", "role": "MAIN" },
      { "id": "ref-id-2", "role": "ASSISTANT" },
      { "id": "ref-id-3", "role": "VAR" }
    ]
  }
  ```
- **Response 예시**:
  ```json
  {
    "ok": true,
    "message": "Successfully assigned 3 referees to match cm12345..."
  }
  ```

### 4.2 경기 결과 업데이트
- **Endpoint**: `PATCH /api/matches/{matchId}/result`
- **Request Body**:
  ```json
  {
    "scoreHome": 2,
    "scoreAway": 1,
    "firstHalfExtraTime": 3,
    "secondHalfExtraTime": 5
  }
  ```
- **Response 예시**:
  ```json
  {
    "ok": true,
    "match": {
      "id": "cm12345...",
      "scoreHome": 2,
      "scoreAway": 1,
      "firstHalfExtraTime": 3,
      "secondHalfExtraTime": 5
    }
  }
  ```

### 4.3 카드 정보 업데이트
- **Endpoint**: `PATCH /api/matches/{matchId}/cards`
- **Request Body**:
  ```json
  {
    "homeYellowCards": 2,
    "homeRedCards": 0,
    "awayYellowCards": 1,
    "awayRedCards": 1
  }
  ```
- **Response 예시**:
  ```json
  {
    "ok": true,
    "matchReferee": {
      "id": "mr-id-123",
      "matchId": "cm12345...",
      "role": "MAIN",
      "homeYellowCards": 2,
      "homeRedCards": 0,
      "awayYellowCards": 1,
      "awayRedCards": 1
    }
  }
  ```
  > [!NOTE]
  > 카드 데이터는 해당 경기의 **주심(MAIN) 레코드**에 업데이트됩니다. 배정된 주심이 없을 경우 404 에러가 반환됩니다.
