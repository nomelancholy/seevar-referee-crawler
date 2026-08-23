import { Match } from './types';

export interface MatchLookupTarget {
  roundId?: string;
  roundNumber: number;
  homeTeamName: string;
  awayTeamName: string;
}

function looselyMatches(left: string, right: string): boolean {
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * 시즌·리그로 이미 제한된 일정에서 반드시 같은 라운드의 경기만 찾는다.
 * 과거 라운드에 동일한 홈/원정 매치업이 있어도 절대 선택하지 않는다.
 */
export function findScheduleMatch(
  matches: Match[],
  target: MatchLookupTarget
): Match | null {
  const sameRound = matches.filter((match) => {
    if (match.roundNumber === target.roundNumber) return true;
    return Boolean(target.roundId && match.roundId === target.roundId);
  });

  const exact = sameRound.filter(
    (match) =>
      match.homeTeamName === target.homeTeamName &&
      match.awayTeamName === target.awayTeamName
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `Ambiguous exact match in round ${target.roundNumber}: ${target.homeTeamName} vs ${target.awayTeamName}`
    );
  }

  const fuzzy = sameRound.filter(
    (match) =>
      looselyMatches(match.homeTeamName, target.homeTeamName) &&
      looselyMatches(match.awayTeamName, target.awayTeamName)
  );
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) {
    throw new Error(
      `Ambiguous fuzzy match in round ${target.roundNumber}: ${target.homeTeamName} vs ${target.awayTeamName}`
    );
  }

  return null;
}
