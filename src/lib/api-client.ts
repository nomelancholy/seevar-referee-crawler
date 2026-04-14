import dotenv from 'dotenv';
import { MatchStatus, RefereeRole, League, Round, Match, Team, Referee } from './types';

dotenv.config();

const API_BASE_URL = process.env.API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:3000';
const CRAWLER_API_KEY = process.env.CRAWLER_API_KEY;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'x-crawler-api-key': CRAWLER_API_KEY || '',
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  // 1. 리그 및 일정 정보
  getLeagues: async (year?: number) => {
    const query = year ? `?year=${year}` : '';
    return request<{ ok: boolean; leagues: League[] }>(`/api/leagues${query}`);
  },

  getSchedule: async (year: number, leagueSlug: string) => {
    return request<{ ok: boolean; count: number; matches: Match[] }>(
      `/api/schedule?year=${year}&league=${leagueSlug}`
    );
  },

  // 2. 라운드 관리
  getRounds: async (leagueId: string, number?: number) => {
    const query = number ? `&number=${number}` : '';
    return request<{ ok: boolean; rounds: Round[] }>(`/api/rounds?leagueId=${leagueId}${query}`);
  },

  createRound: async (data: { leagueId: string; number: number; slug: string }) => {
    return request<{ ok: boolean; round: Round }>('/api/rounds', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  setFocusRound: async (roundId: string) => {
    return request<{ ok: boolean; message: string }>('/api/rounds/focus', {
      method: 'POST',
      body: JSON.stringify({ roundId }),
    });
  },

  // 3. 경기 관리
  createMatch: async (data: {
    roundId: string;
    homeTeamId: string;
    awayTeamId: string;
    playedAt: string;
    venue?: string;
    roundOrder?: number;
  }) => {
    return request<{ ok: boolean; match: Match }>('/api/matches', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateMatchSchedule: async (matchId: string, data: { playedAt: string; venue?: string }) => {
    return request<{ ok: boolean; match: Match }>(`/api/matches/${matchId}/schedule`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  updateMatchStatus: async (matchId: string, status: MatchStatus) => {
    return request<{ ok: boolean; match: Match }>(`/api/matches/${matchId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  updateMatchResult: async (matchId: string, data: {
    scoreHome: number;
    scoreAway: number;
    firstHalfExtraTime?: number;
    secondHalfExtraTime?: number;
  }) => {
    return request<{ ok: boolean; match: Match }>(`/api/matches/${matchId}/result`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  updateMatchCards: async (matchId: string, data: {
    homeYellowCards: number;
    homeRedCards: number;
    awayYellowCards: number;
    awayRedCards: number;
  }) => {
    return request<{ ok: boolean; matchReferee: any }>(`/api/matches/${matchId}/cards`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // 4. 팀 및 심판 정보
  searchTeam: async (name: string) => {
    return request<{ ok: boolean; teams: Team[] }>(`/api/teams/search?name=${encodeURIComponent(name)}`);
  },

  searchReferee: async (name: string) => {
    return request<{ ok: boolean; referees: Referee[] }>(`/api/referees/search?name=${encodeURIComponent(name)}`);
  },

  registerReferee: async (data: { name: string; link?: string }) => {
    return request<{ ok: boolean; referee: Referee }>('/api/referees', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  assignReferees: async (matchId: string, referees: { id: string; role: RefereeRole }[]) => {
    return request<{ ok: boolean; message: string }>(`/api/matches/${matchId}/referees`, {
      method: 'POST',
      body: JSON.stringify({ referees }),
    });
  },
};
