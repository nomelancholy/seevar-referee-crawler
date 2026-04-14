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
        ├─ 매일 02:22 cron → 오늘 경기 목록 크롤링
        │
        ├─ 경기 시작 70분 전 → 심판 배정 동기화
        │
        └─ 경기 시작 127분 후 → 점수/카드/상태 동기화
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

`src/main.ts`의 실행 흐름입니다.

```
PM2 시작 (또는 서버 재부팅)
  └─ dailyTask() 즉시 1회 실행 (당일 놓친 경기 대응)
  └─ cron '22 2 * * *' → 매일 새벽 02:22 KST에 dailyTask() 실행

dailyTask()
  ├─ kleague.com/schedule.do 크롤링 → 오늘 경기 목록 수집
  │
  └─ 경기별 처리:
      ├─ syncRoundAndMatch()  → 라운드 포커스 + 경기 일정 DB 동기화
      │
      ├─ [경기 시작 70분 전] setTimeout → syncRefereeInfo()
      │     kleague.com/match.do (startTabNum=3) 접속
      │     심판 배정 정보 파싱 → /api/matches/{id}/referees 업데이트
      │
      └─ [경기 시작 127분 후] setTimeout → syncMatchResult()
            kleague.com/match.do (startTabNum=1) 접속
            내부 AJAX API 호출:
              - /api/ddf/match/matchInfo.do → 점수(homeGoal, awayGoal), 상태(gameStatus)
              - /api/ddf/match/matchRecord.do → 카드(yellowCards, redCards)
            → /api/matches/{id}/result, /cards, /status 업데이트
```

### gameStatus 값 매핑

| kleague gameStatus | seevar MatchStatus |
|---|---|
| `FE` | `FINISHED` (경기종료) |
| `SH` | `LIVE` (후반진행중) |
| `FH` | `LIVE` (전반진행중) |
| `BF` 또는 기타 | `SCHEDULED` |

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
