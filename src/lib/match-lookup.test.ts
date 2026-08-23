import test from 'node:test';
import assert from 'node:assert/strict';
import { findReversedScheduleMatch, findScheduleMatch } from './match-lookup';
import { parseKstMatchStartTime } from './scraper';
import { Match, MatchStatus } from './types';

function match(id: string, roundNumber: number, homeTeamName: string, awayTeamName: string): Match {
  return {
    id,
    roundId: `round-${roundNumber}`,
    roundNumber,
    year: 2026,
    leagueSlug: 'k-league-1',
    homeTeamName,
    awayTeamName,
    playedAt: '2026-08-22T10:30:00.000Z',
    status: MatchStatus.FINISHED,
    scoreHome: 0,
    scoreAway: 0,
  };
}

test('selects the requested round when the same matchup exists in an earlier round', () => {
  const matches = [
    match('round-6-match', 6, '전북 현대 모터스', '울산 HD FC'),
    match('round-24-match', 24, '전북 현대 모터스', '울산 HD FC'),
  ];

  const found = findScheduleMatch(matches, {
    roundId: 'round-24',
    roundNumber: 24,
    homeTeamName: '전북 현대 모터스',
    awayTeamName: '울산 HD FC',
  });

  assert.equal(found?.id, 'round-24-match');
});

test('does not fall back to the same matchup in another round', () => {
  const found = findScheduleMatch(
    [match('round-6-match', 6, '전북 현대 모터스', '울산 HD FC')],
    {
      roundNumber: 24,
      homeTeamName: '전북 현대 모터스',
      awayTeamName: '울산 HD FC',
    }
  );

  assert.equal(found, null);
});

test('allows normalized partial names only within the requested round', () => {
  const found = findScheduleMatch(
    [match('round-24-match', 24, 'FC 안양', 'FC 서울')],
    {
      roundNumber: 24,
      homeTeamName: '안양',
      awayTeamName: '서울',
    }
  );

  assert.equal(found?.id, 'round-24-match');
});

test('parses a historical KST match time without using today\'s date', () => {
  assert.equal(
    parseKstMatchStartTime('2026.03.15', '14:30')?.toISOString(),
    '2026-03-15T05:30:00.000Z'
  );
});

test('rejects malformed or impossible source times', () => {
  assert.equal(parseKstMatchStartTime('2026-03-15', '14:30'), null);
  assert.equal(parseKstMatchStartTime('2026.03.15', '25:00'), null);
});

test('detects a reversed matchup only in the requested round', () => {
  const matches = [
    match('round-12-reversed', 12, '수원 FC', '충남 아산 FC'),
    match('round-30-direct', 30, '충남 아산 FC', '수원 FC'),
  ];

  assert.equal(
    findReversedScheduleMatch(matches, {
      roundNumber: 12,
      homeTeamName: '충남 아산 FC',
      awayTeamName: '수원 FC',
    })?.id,
    'round-12-reversed'
  );
});
