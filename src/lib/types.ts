export enum MatchStatus {
  SCHEDULED = 'SCHEDULED',
  LIVE = 'LIVE',
  FINISHED = 'FINISHED',
  CANCELLED = 'CANCELLED',
  POSTPONED = 'POSTPONED'
}

export enum RefereeRole {
  MAIN = 'MAIN',
  ASSISTANT = 'ASSISTANT',
  VAR = 'VAR',
  AVAR = 'AVAR',
  WAITING = 'WAITING'
}

export interface League {
  id: string;
  name: string;
  slug: string;
  year: number;
}

export interface Round {
  id: string;
  number: number;
  slug: string;
  isFocus?: boolean;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  emblemPath?: string;
}

export interface Match {
  id: string;
  year: number;
  leagueSlug: string;
  homeTeamName: string;
  awayTeamName: string;
  playedAt: string; // ISO string from API
  status: MatchStatus;
  scoreHome: number;
  scoreAway: number;
  venue?: string;
  roundId?: string;
}

export interface Referee {
  id: string;
  name: string;
  slug: string;
  link?: string;
}
