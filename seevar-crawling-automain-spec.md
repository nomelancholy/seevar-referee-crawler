# SEEVAr-REFEREE-CRAWLER

## 목적

1. K리그1, K리그2 경기 시작 전 배정된 심판 정보를 [SEE VAR](https://seevar.online/) 에 업데이트
2. K리그1, K리그2 경기 종료 후 경기 스코어와 홈/원정팀의 옐로 카드, 레드 카드 정보, 경기 상태를 [SEE VAR](https://seevar.online/) 에 업데이트

## 동작 방식

1. 매일 새벽 2시 22분, K리그 공식 홈페이지 - [Schedule 페이지](https://www.kleague.com/schedule.do) 크롤링하여
   그 날 경기가 있는지 확인 후 없으면 종료. 있으면 2부터 실행

2. 당일 경기에 속한 라운드가 포커스 라운드 (isFocus = true)로 잡혀있는지 확인하고, 포커스 라운드가 아니라면 해당 라운드를 포커스 라운드로 변경한다 (포커스 라운드는 K리그1 1개, K리그2 1개만 가능)

또 해당 라운드에 속한 경기 일정을 DB에 저장되어 있는 경기 일정과 확인하여 일치하면 그대로 두고 일치하지 않으면 경기 시작 정보를 업데이트한다.

3. 경기 시작 1시간 30분 전 즈음 업로드 되는 심판 배정 정보를 확인하기 위해 
   경기 시작 50분 전부터 K리그 [매치센터 페이지](https://www.kleague.com/match.do) 접속.
   해당 URL 에서 사용하는 파라미터 예시는 다음과 같음

   - year=2026
   - leagueId=1
   - gameId=37
   - meetSeq=1
   - startTabNum=3

   심판 배정 정보가 있는지 확인. 심판 배정정보가 나오는 부분의 full xpath는 다음과 같음

   /html/body/div/div[2]/div[2]/ul

   심판 배정 정보가 없다면 30분 이후 다시 시도. 
   심판 배정 정보가 있다면 업데이트 후 4 실행

   (이 부분이 동적으로 생성되기 때문에 크롤링이 어려움. 필요하다면 GEMINI-FLASH 2 AI 모델 사용)

4. 경기는 대략 경기 시작 시각 2시간 전후로 종료되기에 경기 시작 시각 기준 2시간 7분 후 [매치센터 페이지](https://www.kleague.com/match.do) 접속.
   
   경기 스코어와 홈/원정팀의 옐로 카드, 레드 카드 정보를 확인하여 업데이트하고 경기 상태 변경

   각 결과를 확인할 수 있는 부분의 full xpath 정보는 다음과 같음

   경기 상태 

   /html/body/div/div[1]/div/div/div[2]/span/span

   홈 팀 점수

   /html/body/div/div[1]/div/div/div[2]/ul/li[1]

   원정 팀 정수

   /html/body/div/div[1]/div/div/div[2]/ul/li[3]

   홈 팀 획득 카드 정보

   /html/body/div/div[3]/div/div[1]/div[1]/div/ul[1]

   원정팀 획득 카드 정보

   /html/body/div/div[3]/div/div[1]/div[1]/div/ul[2]

   옐로 카드는 <i class="ic-warn1"></i> 로 표시
   레드 카드는 <i class="ic-exit"></i> 로 표시
   경고 누적 퇴장(경고 1장 + 퇴장 1장) 은 <i class="ic-warn2"></i>로 표시
   
   (이 부분도 동적으로 생성되기 때문에 크롤링이 어려움. 필요하다면 GEMINI-FLASH 2 AI 모델 사용)


## 기술 스택 

- Playwright
- Gemini 2.0 Flash
- Prisma

## 참고사항

- SEE VAR는 현재 Digital Ocean의 Droplet에 올라가 있음
- 모든 업데이트는 SEE VAR에서 제공하는 API를 통해 이루어져야 하고 API 가이드는 API_CRAWLER_GUIDE.md 파일에 정의되어 있음
- GEMINI_API_KEY 는 .env 파일에 정의되어 있음


- 심판 Role은 다음과 같다

  - MAIN: "주심",
  - ASSISTANT: "부심",
  - VAR: "VAR",
  - WAITING: "대기심",