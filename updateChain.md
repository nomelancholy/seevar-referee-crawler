요청하신 범위(심판 배정, 경기 결과, 카드 정보)에 맞춰 실제로 어떤 Prisma 모델(테이블)들이 연결되는지 먼저 스키마와 관련 화면 코드를 빠르게 확인해서, 업데이트 대상과 관계를 한 번에 정리해드릴게요.

맞습니다. 이 프로젝트는 직접 입력 테이블과 동기화(파생) 테이블이 분리되어 있어서, 한 번 입력할 때 여러 군데가 같이 움직입니다.

핵심만 정리하면 아래입니다.

심판 배정/결과/카드의 원본은 Match, MatchReferee에 저장
통계성 집계는 RefereeStats, RefereeTeamStat에 반영
팀/심판/리그/라운드는 FK 기준 테이블 (Referee, Team, Round, League, Season)
1) 직접 업데이트해야 하는 테이블
Match
경기 상태/결과: status, scoreHome, scoreAway
(연장 시간도 결과 입력에서 같이 업데이트됨)
MatchReferee
심판 배정: matchId, refereeId, role
카드 입력: homeYellowCards, homeRedCards, awayYellowCards, awayRedCards
즉, 질문하신 3가지 기준으로 보면:

심판 배정 정보 → MatchReferee
경기 결과 → Match
카드 정보 → MatchReferee (심판별 카드)
2) 같이 물리는(자동 동기화) 테이블
lib/actions/admin-matches.ts, lib/actions/admin-results.ts, lib/referee-stats-sync.ts 기준으로 자동 반영됩니다.

RefereeStats
심판 배정 생성/수정/삭제 시 시즌·리그·역할별 matchCount 증감
RefereeTeamStat
심판 배정 생성/수정/삭제 시 팀별 totalAssignments, roleCounts 증감
카드 수정 시 팀별 totalYellowCards, totalRedCards 증감
즉, 실무적으로는 보통 직접 쓰는 건 Match, MatchReferee만이고,
RefereeStats/RefereeTeamStat은 액션/동기화 함수가 관리합니다.

3) 작업 시나리오별 업데이트 세트
심판 배정 추가/수정/삭제:
직접: MatchReferee
자동: RefereeStats, RefereeTeamStat
경기 결과(스코어/상태) 입력:
직접: Match
자동: 캐시 revalidate 중심 (통계 테이블 직접 증감 없음)
카드 입력(심판별):
직접: MatchReferee
자동: RefereeTeamStat 카드 합계 증감
4) 놓치기 쉬운 제약
MatchReferee는 @@unique([matchId, refereeId, role])
같은 경기에서 같은 심판+역할 중복 불가
카드는 심판 단위(MatchReferee)로 들어가므로,
“경기 전체 카드”를 넣고 싶어도 현재 모델상 배정된 심판 행에 분배/기록해야 합니다.
원하시면 다음으로, “운영자가 데이터 넣을 때 순서”를 체크리스트로 만들어드릴게요.
(예: 배정 먼저 → 결과 입력 → 카드 입력, 실패 시 확인 쿼리 포함)