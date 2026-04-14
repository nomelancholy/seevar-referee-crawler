import { chromium, type Page } from 'playwright';
import { api } from './api-client';
import { MatchStatus, RefereeRole } from './types';
import { extractMatchDataWithAI } from './gemini';

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

export async function getTodayMatches(): Promise<MatchInfo[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Navigating to K-League schedule page...');
    await page.goto('https://www.kleague.com/schedule.do', { waitUntil: 'networkidle' });

    const todayBtn = page.locator('button:has-text("TODAY")');
    if (await todayBtn.isVisible()) {
      await todayBtn.click();
      await page.waitForLoadState('networkidle');
    }

    const now = new Date();
    const todayStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
    console.log(`Checking matches for ${todayStr}...`);

    const matches: MatchInfo[] = [];
    
    // Find all rows in the schedule table
    const rows = page.locator('table.table-schedule tbody tr');
    const rowCount = await rows.count();

    let lastRoundNumber = 0;

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      
      const dateCell = row.locator('td.date');
      if (await dateCell.isVisible()) {
        const dateText = await dateCell.innerText();
        const roundMatch = dateText.match(/R(\d+)/);
        if (roundMatch) lastRoundNumber = parseInt(roundMatch[1]);
      }

      const matchCenterLink = row.locator('a:has-text("Match Center")');
      if (await matchCenterLink.isVisible()) {
        const href = await matchCenterLink.getAttribute('href');
        const homeTeam = await row.locator('.team-home').innerText();
        const awayTeam = await row.locator('.team-away').innerText();
        const timeText = await row.locator('.time').innerText(); 

        if (href) {
          const urlParams = new URLSearchParams(href.split('?')[1]);
          const timeParts = timeText.split(':').map(Number);
          const startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), timeParts[0], timeParts[1]);

          matches.push({
            year: urlParams.get('year') || '',
            leagueId: urlParams.get('leagueId') || '',
            gameId: urlParams.get('gameId') || '',
            meetSeq: urlParams.get('meetSeq') || '',
            roundNumber: lastRoundNumber,
            homeTeamName: homeTeam.trim(),
            awayTeamName: awayTeam.trim(),
            startTime,
          });
        }
      }
    }

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
