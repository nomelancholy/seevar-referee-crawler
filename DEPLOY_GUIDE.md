# seevar-referee-crawler 배포 가이드

크롤러를 DigitalOcean Droplet에 올려 **PM2**로 상시 실행하고, **GitHub Actions**로 코드 변경 시 자동 배포하는 방법을 설명합니다.

---

## 전체 아키텍처 개요

```
[GitHub: nomelancholy/seevar-referee-crawler]
        │ push to main
        ▼
[GitHub Actions]
  SSH → Droplet
        │ git pull + npm ci + pm2 reload
        ▼
[DigitalOcean Droplet]
  PM2 → src/main.ts (상시실행)
        │
        ├─ 매일 02:22 cron → 오늘 경기 목록 확인, 라운드 포커스·일정 동기화
        │
        ├─ 매분 cron → 경기 시간대에만 K리그 조회
        │     ├─ 킥오프 2시간 30분 전부터 5분마다 심판 명단 확인 → 나오면 바로 반영
        │     └─ 킥오프부터 2분마다 점수/카드/상태 확인 → 바뀐 값만 반영, 종료되면 멈춤
        │
        └─ 매일 23:20 cron → 오늘 경기 보정 (놓친 값 다시 반영)
                │
                ▼
        [seevar API: https://seevar.online/api/...]
```

---

## 1단계 — Droplet 초기 세팅 (최초 1회)

### 1-1. Droplet에 SSH 접속

```bash
ssh root@<DROPLET_IP>
```

### 1-2. Node.js 설치 (NVM 사용 권장)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

nvm install 20
nvm use 20
nvm alias default 20

node -v   # v20.x.x 확인
npm -v
```

### 1-3. PM2 설치

```bash
npm install -g pm2
```

### 1-4. Playwright 브라우저 의존성 설치

Playwright가 headless Chromium을 실행하려면 시스템 라이브러리가 필요합니다.

```bash
# Ubuntu 22.04 기준
npx playwright install-deps chromium
# 또는 직접 설치
apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libasound2
```

### 1-5. 리포지토리 클론

```bash
cd ~
git clone https://github.com/nomelancholy/seevar-referee-crawler.git
cd seevar-referee-crawler
```

### 1-6. .env 파일 생성

```bash
cat > .env << 'EOF'
API_BASE_URL=https://seevar.online
CRAWLER_API_KEY=<seevar .env의 CRAWLER_API_KEY와 동일한 값>
GEMINI_API_KEY=<Google AI Studio에서 발급한 키>
EOF
```

> **주의**: `CRAWLER_API_KEY`는 seevar 서버의 `.env`에 있는 값과 **반드시 일치**해야 합니다.

### 1-7. 패키지 설치 + Playwright 브라우저 설치

```bash
npm ci
npx playwright install chromium
```

### 1-8. PM2로 실행

```bash
pm2 start ecosystem.config.js
pm2 save                      # 재부팅 후 자동 복구 등록
pm2 startup                   # 출력된 명령어를 복사해서 실행
```

정상 실행 여부 확인:

```bash
pm2 status
pm2 logs seevar-crawler --lines 50
```

---

## 2단계 — GitHub Actions 자동 배포 설정

코드를 push하면 Droplet에 자동으로 반영되도록 설정합니다.  
*seevar 본 서버의 GitHub Actions 방식과 동일한 구조입니다.*

### 2-1. GitHub Secrets 등록

`https://github.com/nomelancholy/seevar-referee-crawler/settings/secrets/actions` 에서 아래 Secrets를 추가합니다.

| Secret 이름 | 값 |
|---|---|
| `SSH_HOST` | Droplet의 IP 주소 (예: `143.198.xxx.xxx`) |
| `SSH_USER` | SSH 접속 유저명 (보통 `root`) |
| `SSH_PRIVATE_KEY` | 로컬 `~/.ssh/id_rsa` 내용 (PEM 전체) |
| `SSH_PASSPHRASE` | SSH 키 패스프레이즈 (없으면 빈칸) |
| `CRAWLER_API_KEY` | seevar API 인증 키 |
| `GEMINI_API_KEY` | Google Gemini API 키 |

> **SSH 키 생성이 필요하다면**:
> ```bash
> ssh-keygen -t rsa -b 4096 -C "crawler-deploy"
> # 퍼블릭 키를 Droplet의 ~/.ssh/authorized_keys 에 추가
> cat ~/.ssh/id_rsa.pub | ssh root@<DROPLET_IP> "cat >> ~/.ssh/authorized_keys"
> ```

### 2-2. GitHub Actions 워크플로우 파일 생성

```bash
mkdir -p .github/workflows
```

`.github/workflows/deploy.yml` 파일을 생성합니다:

```yaml
name: Deploy Crawler to DigitalOcean

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Deploy via SSH
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          passphrase: ${{ secrets.SSH_PASSPHRASE }}
          command_timeout: 10m
          script: |
            cd ~/seevar-referee-crawler

            # 1. 최신 코드 pull
            git pull origin main

            # 2. .env 재생성 (Secrets 기준으로 항상 덮어씀)
            cat > .env << EOF
            API_BASE_URL=https://seevar.online
            CRAWLER_API_KEY=${{ secrets.CRAWLER_API_KEY }}
            GEMINI_API_KEY=${{ secrets.GEMINI_API_KEY }}
            EOF

            # 3. 패키지 설치 (lock 파일 기준)
            npm ci

            # 4. Playwright 브라우저 최신화 (버전 변경 시 대비)
            npx playwright install chromium

            # 5. PM2 프로세스 재시작
            pm2 reload ecosystem.config.js --update-env

            echo "✅ Crawler deployed successfully"
```

커밋 후 push:

```bash
git add .github/workflows/deploy.yml
git commit -m "chore: add GitHub Actions deploy workflow"
git push origin main
```

---

## 3단계 — 스케줄 동작 방식 이해

`src/main.ts`가 cron을 걸고, 실제 판단은 `src/lib/poller.ts`가 경기마다 합니다. 모든 cron은 서버 타임존과 상관없이 KST 기준입니다.

```
PM2 시작 (또는 서버 재부팅·배포)
  └─ loadToday() 즉시 1회 → 오늘 경기를 다시 추적, 이미 시작한 경기는 reconcileToday()로 바로 맞춤

cron '22 2 * * *' → loadToday()
  ├─ getScheduleList.do (K리그1·2) → 오늘 경기 목록
  └─ 경기별 syncRoundAndMatch() → 라운드 포커스 + 경기 일정 동기화
     (목록 조회가 실패하면 10분 뒤 다시 시도)

cron '* * * * *' → pollTick()   할 일이 있는 경기가 없으면 요청 0건
  ├─ 심판 명단: 킥오프 150분 전 ~ 킥오프
  │     getScheduleList.do 의 refreeName1~8 확인 (같은 리그 경기는 요청 하나를 같이 씀)
  │     명단이 나올 때까지 5분 간격 → 나오면 /referees 반영 → 킥오프까지 15분 간격으로 교체 확인
  │     킥오프까지 안 나오면 킥오프 후 30분까지 계속 확인
  │     당일 킥오프 시각이 바뀌면 seevar 일정도 고침
  │
  └─ 경기 진행: 킥오프 ~ 종료(FE) 또는 킥오프 후 4시간
        경기마다 matchInfo.do 2분 간격 → 점수(/result)·상태(/status)·카드(/cards) 중 바뀐 것만 반영
        카드는 주심 배정이 없으면 실패하므로 10분 뒤 다시 시도

cron '20 23 * * *' → reconcileToday()
  └─ 오늘 경기의 심판·점수·상태·카드를 앞서 보낸 값과 상관없이 다시 반영 (누락 보정)

K리그 요청이 실패(오류 응답·타임아웃 15초)하면 2 → 4 → 8 → 15분 쉬었다가 이어서 확인합니다.
```

### gameStatus 값 매핑

| kleague gameStatus | seevar MatchStatus |
|---|---|
| `FE` | `FINISHED` (경기종료) |
| `FH`, `SH` | `LIVE` (전반·후반 진행중) |
| 그 밖의 값 (하프타임·연장 등) | `LIVE` (처음 보는 값은 로그에 남김) |
| 빈 값 | 변경 안 함 (아직 시작 전) |

### 폴링 간격 바꾸기

`src/lib/poller.ts` 상단 상수(`REFEREE_LEAD_MIN`, `REFEREE_POLL_MIN`, `LIVE_POLL_MIN` 등)를 고치면 됩니다. 경기 하나당 K리그 요청은 하루 70건 안팎입니다 (심판 확인은 같은 리그 경기끼리 공유).

### 로컬에서 모의 K리그 서버로 확인

`KLEAGUE_BASE_URL`을 지정하면 K리그 대신 그 주소로 요청합니다 (기본값 `https://www.kleague.com`). `API_BASE_URL`도 로컬 seevar로 지정해 운영 서버에 쓰지 않게 하세요.

---

## 4단계 — 운영 시 유용한 명령어

### 로그 확인

```bash
# 실시간 로그
pm2 logs seevar-crawler

# 최근 100줄
pm2 logs seevar-crawler --lines 100

# 파일로 저장된 로그
tail -f ~/seevar-referee-crawler/logs/out.log
tail -f ~/seevar-referee-crawler/logs/error.log
```

### 프로세스 관리

```bash
# 상태 확인
pm2 status

# 수동 재시작
pm2 restart seevar-crawler

# 중지 / 삭제
pm2 stop seevar-crawler
pm2 delete seevar-crawler

# 설정 변경 후 재적용
pm2 reload ecosystem.config.js --update-env
```

### 특정 경기 수동 테스트 (로컬 또는 서버)

`src/scripts/test-single-match.ts`의 `sampleMatch` 정보를 수정 후:

```bash
npm run test:match
```

---

## 5단계 — 트러블슈팅

### Playwright가 Chromium을 못 찾는 경우

```bash
npx playwright install chromium
# 시스템 라이브러리 부족 시
npx playwright install-deps chromium
```

### PM2 재부팅 후 자동시작 안 될 때

```bash
pm2 startup    # 안내 명령어 복사 실행
pm2 save
```

### cron이 한국시간 기준으로 실행되지 않을 때

Droplet의 타임존이 UTC인 경우 `02:22 KST = 17:22 UTC`이므로 `cron.schedule`을 UTC 기준으로 수정해야 합니다.

```bash
# Droplet 타임존 확인
timedatectl

# 한국시간으로 변경 (선택)
timedatectl set-timezone Asia/Seoul
```

`src/main.ts`의 cron 표현식:

```typescript
// 서버 타임존이 UTC일 때 → 17:22 UTC = 02:22 KST
cron.schedule('22 17 * * *', dailyTask);

// 서버 타임존이 KST일 때
cron.schedule('22 2 * * *', dailyTask);
```

변경 후 반드시 `pm2 reload ecosystem.config.js --update-env`.

### API 401 / 403 오류

- `.env`의 `CRAWLER_API_KEY`가 seevar 서버 `.env`와 **완전히 일치**하는지 확인
- `API_BASE_URL`이 `https://seevar.online` (슬래시 없이)인지 확인

---

## 참고: ecosystem.config.js 현재 설정

```js
module.exports = {
  apps: [{
    name: 'seevar-crawler',
    script: './node_modules/.bin/ts-node',
    args: '-r tsconfig-paths/register src/main.ts',
    watch: false,
    env: { NODE_ENV: 'production' },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file:   './logs/out.log',
    merge_logs: true,
    time: true,
  }],
};
```

> `logs/` 디렉토리가 없으면 PM2 시작 전에 미리 생성해두세요:  
> `mkdir -p ~/seevar-referee-crawler/logs`

---

## 6단계 — 라운드 포커스 수동 확인 (강제 동기화)

cron이 이미 지났거나 `Found 0 matches` 로그가 찍혀 포커스가 바뀌지 않았을 때, **오늘 경기 동기화를 즉시 강제 실행**할 수 있습니다.

### 방법 1: npm 스크립트 (권장)

서버에 SSH 접속 후:

```bash
cd ~/seevar-referee-crawler
npm run sync:today
```

`src/scripts/force-sync-today.ts`를 실행합니다.  
오늘 날짜(KST 기준) 경기를 크롤링하여 **라운드 포커스 설정 + 경기 일정 DB 동기화**를 즉시 처리합니다.

**정상 실행 시 출력 예시:**

```
[2026-04-15 09:00:00 KST] ===== 오늘 경기 강제 동기화 시작 =====
[2026-04-15 09:00:01 KST] K-League 스케줄 페이지 크롤링 중...
[2026-04-15 09:00:06 KST] ✅ 오늘 경기 3개 발견:
  [1] R8 | 전북 vs 서울 | leagueId=1 | gameId=41
  [2] R8 | 수원 vs 포항 | leagueId=1 | gameId=42
  [3] R8 | 인천 vs 울산 | leagueId=1 | gameId=43

[2026-04-15 09:00:06 KST] syncRoundAndMatch() 실행 중...
[2026-04-15 09:00:07 KST] --- 전북 vs 서울 (Round 8) ---
Setting Round 8 as focused round for k-league-1
[2026-04-15 09:00:08 KST] 완료: 전북 vs 서울
...
[2026-04-15 09:00:12 KST] ===== 강제 동기화 완료 =====
  → seevar 관리 페이지에서 해당 라운드가 포커스로 설정됐는지 확인하세요.
```

> **경기가 0개로 나오는 경우**: K-League 사이트의 TODAY 필터가 제대로 동작했는지 확인.  
> `kleague.com/schedule.do` 를 직접 접속해서 날짜와 경기 목록 확인.

### 방법 2: dailyTask() 전체 재실행 (PM2 재시작)

cron을 기다리지 않고 PM2 프로세스를 재시작하면 `main.ts` 시작 직후 `dailyTask()`가 즉시 1회 실행됩니다.

```bash
# PM2 재시작 → dailyTask() 즉시 실행됨
pm2 restart seevar-crawler

# 로그로 결과 확인
pm2 logs seevar-crawler --lines 50
```

> **주의**: 재시작 시 기존의 `setTimeout` 예약 (심판 동기화, 결과 동기화) 이 모두 초기화됩니다.  
> 경기가 아직 시작 전이라면 재시작 후 자동으로 재스케줄됩니다.

### 방법 3: 특정 경기만 지정해서 테스트

K-League match 페이지 URL에서 파라미터를 직접 확인한 뒤 `src/scripts/test-single-match.ts`의 `sampleMatch` 값을 수정하고 실행:

```bash
# URL 예시: kleague.com/match.do?year=2026&leagueId=1&gameId=41&meetSeq=1
# ↓ 위 파라미터를 그대로 입력

npm run test:match
```

`test-single-match.ts`는 `syncRoundAndMatch` + `syncRefereeInfo` + `syncMatchResult`를 순서대로 모두 실행합니다.

---

## 7단계 — 시즌 데이터 안전 복구

같은 홈·원정 매치업이 여러 라운드에 존재할 때 과거 경기로 잘못 동기화된 경우 사용합니다.
복구는 `연도 + 리그 + 라운드 번호 + 홈팀 + 원정팀`으로 기존 경기만 찾으며, 경기나 라운드를 새로 만들지 않습니다.

사용자 평점·한줄평(`RefereeReview`), 댓글, 모멘트, 반응은 수정하지 않습니다. 공식 경기 일시·점수·상태·카드·심판 배정만 동기화합니다.

```bash
# 1. 대상 경기와 See VAR 경기 ID 확인(데이터 변경 없음)
npm run backfill -- --from=2026-02-28 --to=2026-08-22

# 2. 출력 마지막이 skipped=0인지 확인한 뒤에만 실제 반영
npm run backfill -- --from=2026-02-28 --to=2026-08-22 --apply
```

`--apply`가 없으면 항상 드라이런입니다. K리그 원본 목록만 확인하려면 `--source-only`를 추가합니다.
