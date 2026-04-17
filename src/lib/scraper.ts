import { chromium, type Page } from 'playwright';
import { api } from './api-client';
import { MatchStatus, RefereeRole } from './types';
import { extractMatchDataWithAI } from './gemini';

/**
 * Returns a KST-formatted timestamp string for logging.
 * Example: "2026-04-15 02:22:04 KST"
 */
export function nowKST(): string {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'Asia/Seoul',
    hour12: false,
  }).replace('T', ' ') + ' KST';
}

export interface MatchInfo {
  year: string;
  leagueId: string;
  gameId: string;
  meetSeq: string;
  roundNumber: number;
  startTime?: Date;
  homeTeamName: string;
  awayTeamName: string;
}

/**
 * Maps scraped leagueId to API league slug.
 */
function mapLeagueIdToSlug(leagueId: string): string {
  // Mapping based on user's production server setting
  return leagueId === '1' ? 'k-league-1' : 'k-league-2';
}

/**
 * Helper to find match ID from API based on scraped info.
 */
async function getApiMatchId(match: MatchInfo): Promise<string | null> {
  const year = parseInt(match.year);
  const leagueSlug = mapLeagueIdToSlug(match.leagueId);
  const scheduleRes = await api.getSchedule(year, leagueSlug);
  
  const found = scheduleRes.matches.find(m => 
    (m.homeTeamName.includes(match.homeTeamName) || match.homeTeamName.includes(m.homeTeamName)) && 
    (m.awayTeamName.includes(match.awayTeamName) || match.awayTeamName.includes(m.awayTeamName))
  );
  
  return found?.id || null;
}

export async function getTodayMatches(targetDate?: string): Promise<MatchInfo[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // KST 기준 대상 날짜 설정 (서버 타임존이 KST로 설정된 경우)
    const nowKstDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const todayStr = targetDate || `${nowKstDate.getFullYear()}.${String(nowKstDate.getMonth() + 1).padStart(2, '0')}.${String(nowKstDate.getDate()).padStart(2, '0')}`;
    console.log(`[${nowKST()}] Checking matches for ${todayStr}...`);

    const parts = todayStr.split('.');
    const year = parts[0];
    const month = parts[1];
    
    // session 쿠키 등을 위해 메인 페이지 한 번 접근을 권장하지만, API 호출은 불필요할 수도 있음.
    // 혹시 모르니 빈 페이지에서 evaluate로 fetch 요청을 보냅니다.
    await page.goto('https://www.kleague.com', { waitUntil: 'domcontentloaded' });
    
    const matches: MatchInfo[] = [];

    const scraped = await page.evaluate(async (reqData) => {
      const out: any[] = [];
      for (const leagueId of ['1', '2']) {
        try {
          const res = await fetch('/getScheduleList.do', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year: reqData.year, month: reqData.month, leagueId })
          }).then(r => r.json());
          
          if (res?.data?.scheduleList) {
            for (const item of res.data.scheduleList) {
              if (item.gameDate === reqData.todayStr) {
                const [h, mi] = (item.gameTime || '').split(':').map((x: string) => parseInt(x, 10));
                if (!Number.isNaN(h) && !Number.isNaN(mi)) {
                  out.push({
                    year: String(item.year),
                    leagueId: String(item.leagueId),
                    gameId: String(item.gameId),
                    meetSeq: String(item.meetSeq),
                    roundNumber: parseInt(item.roundId, 10),
                    homeTeamName: item.homeTeamName,
                    awayTeamName: item.awayTeamName,
                    timeHour: h,
                    timeMinute: mi,
                  });
                }
              }
            }
          }
        } catch (e) {
          console.error(e);
        }
      }
      return out;
    }, { year, month, todayStr });

    for (const row of scraped) {
      const startTime = new Date(nowKstDate.getFullYear(), nowKstDate.getMonth(), nowKstDate.getDate(), row.timeHour, row.timeMinute);
      matches.push({
        year: row.year,
        leagueId: row.leagueId,
        gameId: row.gameId,
        meetSeq: row.meetSeq,
        roundNumber: row.roundNumber,
        homeTeamName: row.homeTeamName,
        awayTeamName: row.awayTeamName,
        startTime,
      });
    }

    console.log(`[${nowKST()}] Found ${matches.length} matches for ${todayStr}.`);
    return matches;
  } finally {
    await browser.close();
  }
}

export async function syncRefereeInfo(match: MatchInfo) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const url = `https://www.kleague.com/match.do?year=${match.year}&leagueId=${match.leagueId}&gameId=${match.gameId}&meetSeq=${match.meetSeq}&startTabNum=3`;
  
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    
    const refereeList = page.locator('xpath=/html/body/div/div[2]/div[2]/ul');
    if (await refereeList.isVisible()) {
      const text = await refereeList.innerText();
      console.log(`Match ${match.homeTeamName} vs ${match.awayTeamName}: Referee data: ${text}`);
      
      const parts = text.split(/\n|\|/).map(p => p.trim()).filter(p => p.length > 0);
      const assignments: { id: string; role: RefereeRole }[] = [];
      
      for (const part of parts) {
        if (part.toUpperCase().includes('TSG')) {
          console.log(`Skipping non-referee data: ${part}`);
          continue;
        }

        const [label, namesStr] = part.split(':').map(s => s.trim());
        if (!label || !namesStr) continue;

        const role = mapLabelToRole(label);
        if (!role) continue;

        const names = namesStr.split(',').map(n => n.trim());
        for (const name of names) {
          const refereeId = await ensureReferee(name);
          if (refereeId) assignments.push({ id: refereeId, role });
        }
      }

      if (assignments.length > 0) {
        const matchId = await getApiMatchId(match);
        if (matchId) {
          await api.assignReferees(matchId, assignments);
          console.log(`Successfully assigned ${assignments.length} referees to match ${matchId}`);
        }
      }
    } else {
      console.log('XPath not found, trying Gemini AI fallback...');
      const screenshot = await page.screenshot({ fullPage: true });
      const base64 = screenshot.toString('base64');
      const prompt = `Extract K-League referee information from this screenshot. Return a JSON object with keys like "Refree", "Assistance", "VAR", etc. Values should be names separated by commas.`;
      const aiData = await extractMatchDataWithAI(base64, prompt);
      
      if (typeof aiData === 'object') {
        const assignments: { id: string; role: RefereeRole }[] = [];
        for (const [label, namesStr] of Object.entries(aiData)) {
          const role = mapLabelToRole(label);
          if (!role) continue;
          const names = (namesStr as string).split(',').map(n => n.trim());
          for (const name of names) {
            const refereeId = await ensureReferee(name);
            if (refereeId) assignments.push({ id: refereeId, role });
          }
        }
        
        if (assignments.length > 0) {
          const matchId = await getApiMatchId(match);
          if (matchId) {
            await api.assignReferees(matchId, assignments);
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
}

function mapLabelToRole(label: string): RefereeRole | null {
  const lower = label.toLowerCase();
  if (lower.includes('refree') || lower.includes('주심')) return RefereeRole.MAIN;
  if (lower.includes('assistance') || lower.includes('부심')) return RefereeRole.ASSISTANT;
  if (lower.includes('var')) return RefereeRole.VAR;
  if (lower.includes('waiting') || lower.includes('대기심')) return RefereeRole.WAITING;
  return null;
}

async function ensureReferee(name: string): Promise<string | null> {
  const searchRes = await api.searchReferee(name);
  if (searchRes.referees.length > 0) {
    return searchRes.referees[0].id;
  }
  
  console.log(`Referee ${name} not found. Registering new...`);
  const registerRes = await api.registerReferee({ name });
  return registerRes.referee.id;
}

export async function syncMatchResult(match: MatchInfo) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // K-League match page — session cookie is needed for internal AJAX APIs
  const url = `https://www.kleague.com/match.do?year=${match.year}&leagueId=${match.leagueId}&gameId=${match.gameId}&meetSeq=${match.meetSeq}&startTabNum=1`;

  try {
    console.log(`Navigating to match result page: ${url}`);
    // domcontentloaded is enough; we'll call the AJAX APIs ourselves using the session cookie
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // --- Call K-League internal AJAX APIs (they share the browser's session cookie) ---
    const postBody = `year=${match.year}&meetSeq=${match.meetSeq}&gameId=${match.gameId}`;

    // 1. matchInfo.do  →  gameStatus, homeGoal, awayGoal
    const matchInfoData = await page.evaluate(async (body: string) => {
      const res = await fetch('/api/ddf/match/matchInfo.do', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      return res.json();
    }, postBody);

    console.log(`matchInfo API response: gameStatus=${matchInfoData?.data?.gameStatus}, homeGoal=${matchInfoData?.data?.homeGoal}, awayGoal=${matchInfoData?.data?.awayGoal}`);

    // 2. matchRecord.do  →  home/away yellow/red card counts
    const matchRecordData = await page.evaluate(async (body: string) => {
      const res = await fetch('/api/ddf/match/matchRecord.do', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      return res.json();
    }, postBody);

    console.log(`matchRecord API response: home=${JSON.stringify(matchRecordData?.data?.home)}, away=${JSON.stringify(matchRecordData?.data?.away)}`);

    // --- Parse results ---
    const homeScore: number = matchInfoData?.data?.homeGoal ?? 0;
    const awayScore: number = matchInfoData?.data?.awayGoal ?? 0;
    console.log(`Scores extracted: ${homeScore} - ${awayScore}`);

    const homeYellow: number = matchRecordData?.data?.home?.yellowCards ?? 0;
    const homeRed: number = (matchRecordData?.data?.home?.redCards ?? 0) + (matchRecordData?.data?.home?.doubleYellowCards ?? 0);
    const awayYellow: number = matchRecordData?.data?.away?.yellowCards ?? 0;
    const awayRed: number = (matchRecordData?.data?.away?.redCards ?? 0) + (matchRecordData?.data?.away?.doubleYellowCards ?? 0);
    console.log(`Cards extracted: Home(Y:${homeYellow}, R:${homeRed}), Away(Y:${awayYellow}, R:${awayRed})`);

    // gameStatus values: "FE" = 경기종료, "SH" = 후반, "FH" = 전반, "BF" = 경기전
    const gameStatus: string = matchInfoData?.data?.gameStatus ?? '';
    const isFinished = gameStatus === 'FE';
    const isLive = gameStatus === 'SH' || gameStatus === 'FH';
    const apiStatus = isFinished ? MatchStatus.FINISHED : isLive ? MatchStatus.LIVE : MatchStatus.SCHEDULED;
    console.log(`Match status: "${gameStatus}" → ${apiStatus}`);

    // --- Push to our API ---
    const matchId = await getApiMatchId(match);
    if (matchId) {
      await api.updateMatchResult(matchId, { scoreHome: homeScore, scoreAway: awayScore });
      await api.updateMatchStatus(matchId, apiStatus);
      console.log(`Updating match ${matchId} status to: ${apiStatus}`);
      await api.updateMatchCards(matchId, {
        homeYellowCards: homeYellow,
        homeRedCards: homeRed,
        awayYellowCards: awayYellow,
        awayRedCards: awayRed,
      });
      console.log(`Successfully synced result and cards for match ${matchId}`);
    } else {
      console.warn(`Could not find match ID for result sync: ${match.homeTeamName} vs ${match.awayTeamName}`);
    }
  } finally {
    await browser.close();
  }
}
