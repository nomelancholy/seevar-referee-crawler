import { api } from './api-client';
import { syncRoundAndMatch } from './round-service';
import {
  MatchInfo,
  MatchResult,
  RefereeName,
  extractRefereeNames,
  fetchMatchResult,
  fetchScheduleList,
  findScheduleItem,
  getApiMatchId,
  getTodayMatches,
  kstDateString,
  nowKST,
  pushRefereeAssignments,
  toMatchInfo,
} from './scraper';
import { MatchStatus } from './types';

/**
 * 경기일 폴링.
 * - 심판 명단: 킥오프 2시간 30분 전부터 5분마다 확인해 나오는 대로 반영하고, 이후 킥오프까지 15분마다 교체를 확인한다.
 * - 경기 진행: 킥오프부터 2분마다 스코어·상태·카드를 확인해 바뀐 값만 반영하고, 종료(FE)되면 멈춘다.
 * - 보정(23:20): 오늘 경기를 한 번 더 확인해 놓친 값을 맞춘다.
 * pollTick()은 매분 돌지만 확인할 경기가 없으면 아무 요청도 보내지 않는다.
 */

const MINUTE = 60 * 1000;

const REFEREE_LEAD_MIN = 150;
const REFEREE_POLL_MIN = 5;
const REFEREE_RECHECK_MIN = 15;
// 킥오프까지 명단이 안 나오면 30분 더 기다린다
const REFEREE_GRACE_MIN = 30;
const LIVE_POLL_MIN = 2;
// 킥오프 4시간 뒤까지 종료(FE)가 안 뜨면 보정에 맡긴다
const LIVE_WINDOW_MIN = 240;
// 주심 배정 전이라 카드 반영이 실패하면 10분 뒤 다시 시도
const CARD_RETRY_MIN = 10;
// seevar 라운드·일정 동기화가 실패했을 때 다시 시도하는 간격
const ROUND_SYNC_RETRY_MIN = 30;
// 오늘 경기 목록을 못 받으면 10분 뒤 다시 시도
const DAY_RETRY_MIN = 10;
// K리그 요청 사이 간격. 연속으로 실패하면 2·4·8·15분 쉰다
const KLEAGUE_REQUEST_GAP_MS = 500;
const KLEAGUE_BACKOFF_MAX_MIN = 15;
// 이 밖의 gameStatus는 경기 중으로 처리하고 처음 볼 때 로그를 남긴다
const KNOWN_GAME_STATUSES = ['FH', 'SH', 'FE'];
const NO_CARDS = '0/0:0/0';

interface TrackedMatch {
  info: MatchInfo;
  kickoff: number;
  gameDate: string;
  seevarMatchId?: string;
  roundSynced: boolean;
  nextRoundSyncAt: number;
  /** 마지막으로 반영한 심판 명단. 없으면 아직 반영 전 */
  refereeSignature?: string;
  nextRefereeCheckAt: number;
  nextLiveCheckAt: number;
  pushedScore?: string;
  pushedStatus?: MatchStatus;
  pushedCards: string;
  cardsRetryAt: number;
  finished: boolean;
  seenGameStatuses: Set<string>;
}

const tracked = new Map<string, TrackedMatch>();
let dayRetryAt: number | null = null;
let reconcileRetry: { at: number; date: string } | null = null;
let kleagueFailures = 0;
let kleaguePausedUntil = 0;

// 일정 불러오기·폴링·보정이 같은 상태를 건드리므로 한 번에 하나씩 실행한다
let queue: Promise<void> = Promise.resolve();
let tickQueued = false;

function enqueue(name: string, task: () => Promise<void>): Promise<void> {
  const run = queue.then(task).catch((error) => {
    console.error(`[${nowKST()}] ${name} error:`, error);
  });
  queue = run;
  return run;
}

/** 오늘 경기 목록을 받아 라운드 포커스·경기 일정을 맞추고 추적을 시작한다. */
export function loadToday(now?: Date): Promise<void> {
  return enqueue('loadToday', () => runLoadDay(now ?? new Date()));
}

/** 매분 호출한다. 앞선 회차가 끝나지 않았으면 이번 회차는 건너뛴다. */
export function pollTick(now?: Date): Promise<void> {
  if (tickQueued) return Promise.resolve();
  tickQueued = true;
  return enqueue('pollTick', async () => {
    try {
      await runTick(now ?? new Date());
    } finally {
      tickQueued = false;
    }
  });
}

/** 오늘 경기의 심판·스코어·상태·카드를 앞서 보낸 값과 상관없이 다시 보낸다. */
export function reconcileToday(now?: Date): Promise<void> {
  return enqueue('reconcileToday', async () => {
    const at = now ?? new Date();
    await runReconcile(at, kstDateString(at));
  });
}

function keyOf(info: MatchInfo): string {
  return `${info.year}-${info.leagueId}-${info.meetSeq}-${info.gameId}`;
}

function label(m: TrackedMatch): string {
  return `${m.info.homeTeamName} vs ${m.info.awayTeamName}`;
}

function scheduleMonth(m: TrackedMatch): string {
  return m.gameDate.split('.')[1];
}

function signatureOf(referees: RefereeName[]): string {
  return referees.map((r) => `${r.role}:${r.name}`).join('|');
}

function kickoffOffset(m: TrackedMatch, t: number): string {
  const diff = Math.round((m.kickoff - t) / MINUTE);
  return diff >= 0 ? `킥오프 ${diff}분 전` : `킥오프 ${-diff}분 후`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** K리그 요청 공통 처리: 요청 사이에 간격을 두고, 연속으로 실패하면 잠시 쉰다. */
async function kleague<T>(now: Date, request: () => Promise<T>): Promise<T> {
  if (now.getTime() < kleaguePausedUntil) {
    throw new Error('K League requests are paused after failures');
  }
  try {
    const result = await request();
    kleagueFailures = 0;
    return result;
  } catch (error) {
    kleagueFailures++;
    const pauseMin = Math.min(2 ** kleagueFailures, KLEAGUE_BACKOFF_MAX_MIN);
    kleaguePausedUntil = now.getTime() + pauseMin * MINUTE;
    const reason = error instanceof Error ? error.message : error;
    console.error(`[${nowKST(now)}] K리그 요청 실패(${kleagueFailures}회 연속), ${pauseMin}분 쉼: ${reason}`);
    throw error;
  } finally {
    await sleep(KLEAGUE_REQUEST_GAP_MS);
  }
}

async function runLoadDay(now: Date): Promise<void> {
  const t = now.getTime();
  const dateStr = kstDateString(now);
  dayRetryAt = null;

  // 진행 확인 시간이 끝난 지난 날짜 경기는 정리한다
  for (const [key, m] of tracked) {
    if (m.gameDate !== dateStr && t > m.kickoff + LIVE_WINDOW_MIN * MINUTE) tracked.delete(key);
  }

  let matches: MatchInfo[];
  try {
    matches = await kleague(now, () => getTodayMatches(dateStr, { strict: true, refreshSource: true }));
  } catch {
    dayRetryAt = Math.max(t + DAY_RETRY_MIN * MINUTE, kleaguePausedUntil);
    console.log(`[${nowKST(now)}] ${dateStr} 경기 목록을 못 받아 ${nowKST(new Date(dayRetryAt))}에 다시 시도`);
    return;
  }

  console.log(`[${nowKST(now)}] ${dateStr} 경기 ${matches.length}개`);
  for (const info of matches) {
    const key = keyOf(info);
    // 같은 날 다시 불러와도 이미 추적 중인 경기의 진행 상태는 그대로 둔다
    if (!info.startTime || tracked.has(key)) continue;

    const m: TrackedMatch = {
      info,
      kickoff: info.startTime.getTime(),
      gameDate: dateStr,
      roundSynced: false,
      nextRoundSyncAt: 0,
      nextRefereeCheckAt: 0,
      nextLiveCheckAt: 0,
      // seevar 카드 기본값이 0이라 처음부터 0장을 보낼 필요는 없다
      pushedCards: NO_CARDS,
      cardsRetryAt: 0,
      finished: false,
      seenGameStatuses: new Set(),
    };
    tracked.set(key, m);
    console.log(`[${nowKST(now)}]   R${info.roundNumber} ${label(m)} 킥오프 ${nowKST(info.startTime)}`);
    await syncRound(m, now);
  }
}

async function runTick(now: Date): Promise<void> {
  const t = now.getTime();
  if (dayRetryAt !== null && t >= dayRetryAt) await runLoadDay(now);
  if (reconcileRetry && t >= reconcileRetry.at) await runReconcile(now, reconcileRetry.date);

  for (const m of tracked.values()) {
    if (!m.roundSynced && t >= m.nextRoundSyncAt) await syncRound(m, now);
  }

  if (t < kleaguePausedUntil) return;

  // 심판 명단: 같은 리그·월 경기는 일정 요청 하나를 같이 쓴다
  const lists = new Map<string, any[]>();
  for (const m of [...tracked.values()]) {
    if (!isRefereeCheckDue(m, t)) continue;
    const listKey = `${m.info.year}-${scheduleMonth(m)}-${m.info.leagueId}`;
    let list = lists.get(listKey);
    if (!list) {
      try {
        list = await kleague(now, () => fetchScheduleList(m.info.year, scheduleMonth(m), m.info.leagueId));
      } catch {
        return;
      }
      lists.set(listKey, list);
    }
    await checkReferees(m, list, now);
  }

  // 경기 진행: 경기마다 매치센터 데이터를 확인한다
  for (const m of [...tracked.values()]) {
    if (!isLiveCheckDue(m, t)) continue;
    let result: MatchResult;
    try {
      result = await kleague(now, () => fetchMatchResult(m.info));
    } catch {
      return;
    }
    await applyLiveResult(m, result, now);
  }
}

function isRefereeCheckDue(m: TrackedMatch, t: number): boolean {
  if (t < m.nextRefereeCheckAt || t < m.kickoff - REFEREE_LEAD_MIN * MINUTE) return false;
  // 명단을 반영했으면 킥오프까지만 교체를 확인하고, 아직 못 받았으면 킥오프 후 30분까지 기다린다
  const until = m.refereeSignature ? m.kickoff : m.kickoff + REFEREE_GRACE_MIN * MINUTE;
  return t <= until;
}

function isLiveCheckDue(m: TrackedMatch, t: number): boolean {
  return (
    !m.finished &&
    t >= m.nextLiveCheckAt &&
    t >= m.kickoff &&
    t <= m.kickoff + LIVE_WINDOW_MIN * MINUTE
  );
}

async function syncRound(m: TrackedMatch, now: Date): Promise<void> {
  m.nextRoundSyncAt = now.getTime() + ROUND_SYNC_RETRY_MIN * MINUTE;
  try {
    const { matchId } = await syncRoundAndMatch(m.info);
    if (matchId) m.seevarMatchId = matchId;
    m.roundSynced = true;
  } catch (error) {
    console.error(`[${nowKST(now)}] ${label(m)} 라운드·일정 동기화 실패, ${ROUND_SYNC_RETRY_MIN}분 뒤 다시 시도:`, error);
  }
}

async function resolveMatchId(m: TrackedMatch, now: Date): Promise<string | null> {
  if (m.seevarMatchId) return m.seevarMatchId;
  try {
    const matchId = await getApiMatchId(m.info);
    if (matchId) {
      m.seevarMatchId = matchId;
      return matchId;
    }
    console.warn(`[${nowKST(now)}] ${label(m)} seevar에서 경기를 찾지 못함`);
    // seevar에 경기가 아직 없을 수 있으니 다음 회차에 일정 동기화를 다시 해 본다 (30분에 한 번)
    if (now.getTime() >= m.nextRoundSyncAt) m.roundSynced = false;
  } catch (error) {
    console.error(`[${nowKST(now)}] ${label(m)} seevar 경기 조회 실패:`, error);
  }
  return null;
}

async function checkReferees(m: TrackedMatch, list: any[], now: Date): Promise<void> {
  const t = now.getTime();
  m.nextRefereeCheckAt = t + (m.refereeSignature ? REFEREE_RECHECK_MIN : REFEREE_POLL_MIN) * MINUTE;

  const item = findScheduleItem(list, m.info);
  if (!item) return;

  // 당일 킥오프 시각이나 날짜가 바뀌었으면 따라간다
  const latest = toMatchInfo(item);
  if (latest?.startTime && latest.startTime.getTime() !== m.kickoff) {
    if (item.gameDate !== m.gameDate) {
      console.log(`[${nowKST(now)}] ${label(m)} 경기 날짜가 ${item.gameDate}로 바뀌어 오늘 추적에서 뺌`);
      tracked.delete(keyOf(m.info));
      return;
    }
    console.log(`[${nowKST(now)}] ${label(m)} 킥오프 시각 변경 → ${item.gameTime}`);
    m.info.startTime = latest.startTime;
    m.kickoff = latest.startTime.getTime();
    // 다음 회차에 seevar 경기 일시도 맞춘다
    m.roundSynced = false;
    m.nextRoundSyncAt = 0;
  }

  const referees = extractRefereeNames(item);
  if (referees.length === 0) return;
  const signature = signatureOf(referees);
  if (signature === m.refereeSignature) return;

  const matchId = await resolveMatchId(m, now);
  if (!matchId) return;
  try {
    const count = await pushRefereeAssignments(matchId, referees);
    const isChange = m.refereeSignature !== undefined;
    m.refereeSignature = signature;
    m.nextRefereeCheckAt = t + REFEREE_RECHECK_MIN * MINUTE;
    console.log(`[${nowKST(now)}] ${label(m)} 심판 ${count}명 ${isChange ? '변경 반영' : '반영'} (${kickoffOffset(m, t)})`);
  } catch (error) {
    console.error(`[${nowKST(now)}] ${label(m)} 심판 반영 실패:`, error);
  }
}

async function applyLiveResult(m: TrackedMatch, result: MatchResult, now: Date): Promise<void> {
  m.nextLiveCheckAt = now.getTime() + LIVE_POLL_MIN * MINUTE;
  if (!result.status) return;

  if (!KNOWN_GAME_STATUSES.includes(result.gameStatus) && !m.seenGameStatuses.has(result.gameStatus)) {
    m.seenGameStatuses.add(result.gameStatus);
    console.log(`[${nowKST(now)}] ${label(m)} 처음 보는 gameStatus "${result.gameStatus}" → ${result.status}로 처리`);
  }

  const matchId = await resolveMatchId(m, now);
  if (!matchId) return;
  if ((await pushResult(m, matchId, result, now, false)) && result.status === MatchStatus.FINISHED) {
    m.finished = true;
  }
}

/**
 * 앞서 보낸 값과 달라진 것만 seevar에 보낸다(force면 모두). 스코어·상태까지 반영되면 true.
 * 카드는 주심 배정이 없으면 실패하므로 결과와 따로 재시도한다.
 */
async function pushResult(
  m: TrackedMatch,
  matchId: string,
  result: MatchResult,
  now: Date,
  force: boolean
): Promise<boolean> {
  const t = now.getTime();
  const score = `${result.scoreHome}:${result.scoreAway}`;
  const { cards } = result;
  const cardKey = `${cards.homeYellowCards}/${cards.homeRedCards}:${cards.awayYellowCards}/${cards.awayRedCards}`;
  const changes: string[] = [];

  try {
    if (force || score !== m.pushedScore) {
      await api.updateMatchResult(matchId, { scoreHome: result.scoreHome, scoreAway: result.scoreAway });
      m.pushedScore = score;
      changes.push(`스코어 ${score}`);
    }
    if (result.status && (force || result.status !== m.pushedStatus)) {
      await api.updateMatchStatus(matchId, result.status);
      m.pushedStatus = result.status;
      changes.push(result.status);
    }
  } catch (error) {
    console.error(`[${nowKST(now)}] ${label(m)} 스코어·상태 반영 실패:`, error);
    return false;
  }

  if (force || (cardKey !== m.pushedCards && t >= m.cardsRetryAt)) {
    try {
      await api.updateMatchCards(matchId, cards);
      m.pushedCards = cardKey;
      changes.push(
        `카드 홈 Y${cards.homeYellowCards} R${cards.homeRedCards} / 원정 Y${cards.awayYellowCards} R${cards.awayRedCards}`
      );
    } catch (error) {
      m.cardsRetryAt = t + CARD_RETRY_MIN * MINUTE;
      console.error(`[${nowKST(now)}] ${label(m)} 카드 반영 실패, ${CARD_RETRY_MIN}분 뒤 다시 시도:`, error);
    }
  }

  if (changes.length > 0) {
    console.log(`[${nowKST(now)}] ${label(m)} ${force ? '보정 ' : ''}반영: ${changes.join(', ')} (${kickoffOffset(m, t)})`);
  }
  return true;
}

async function runReconcile(now: Date, date: string): Promise<void> {
  reconcileRetry = null;
  const t = now.getTime();
  const matches = [...tracked.values()].filter((m) => m.gameDate === date && t >= m.kickoff);
  if (matches.length === 0) return;
  console.log(`[${nowKST(now)}] ${date} 경기 ${matches.length}개 보정 시작`);

  const lists = new Map<string, any[]>();
  for (const m of matches) {
    let list: any[] | undefined;
    let result: MatchResult;
    try {
      const listKey = `${m.info.year}-${scheduleMonth(m)}-${m.info.leagueId}`;
      list = lists.get(listKey);
      if (!list) {
        list = await kleague(now, () => fetchScheduleList(m.info.year, scheduleMonth(m), m.info.leagueId));
        lists.set(listKey, list);
      }
      result = await kleague(now, () => fetchMatchResult(m.info));
    } catch {
      // K리그 요청이 막히면 쉬는 시간이 끝난 뒤 이 날짜 보정을 처음부터 다시 한다
      reconcileRetry = { at: Math.max(kleaguePausedUntil, t + MINUTE), date };
      return;
    }

    const matchId = await resolveMatchId(m, now);
    if (!matchId) continue;

    const item = findScheduleItem(list, m.info);
    const referees = item ? extractRefereeNames(item) : [];
    if (referees.length > 0) {
      try {
        await pushRefereeAssignments(matchId, referees);
        m.refereeSignature = signatureOf(referees);
      } catch (error) {
        console.error(`[${nowKST(now)}] ${label(m)} 심판 보정 실패:`, error);
      }
    }

    if (result.status && (await pushResult(m, matchId, result, now, true)) && result.status === MatchStatus.FINISHED) {
      m.finished = true;
    }
  }
  console.log(`[${nowKST(now)}] ${date} 보정 완료`);
}
