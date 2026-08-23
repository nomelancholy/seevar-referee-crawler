import {
  getApiMatchId,
  getTodayMatches,
  syncMatchResult,
  syncRefereeInfo,
} from '../lib/scraper';
import { syncRoundAndMatch } from '../lib/round-service';

type BackfillOptions = {
  from: string;
  to: string;
  apply: boolean;
  sourceOnly: boolean;
};

function parseOptions(argv: string[]): BackfillOptions {
  const values = new Map(
    argv
      .filter((arg) => arg.startsWith('--') && arg.includes('='))
      .map((arg) => {
        const separator = arg.indexOf('=');
        return [arg.slice(2, separator), arg.slice(separator + 1)];
      })
  );
  const from = values.get('from') ?? '2026-02-28';
  const to = values.get('to') ?? new Date().toISOString().slice(0, 10);
  const apply = argv.includes('--apply');
  const sourceOnly = argv.includes('--source-only');

  for (const [label, value] of [['from', from], ['to', to]] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`))) {
      throw new Error(`Invalid --${label} date: ${value}`);
    }
  }
  if (from > to) throw new Error('--from must be on or before --to');

  return { from, to, apply, sourceOnly };
}

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function toCrawlerDate(date: string): string {
  return date.replace(/-/g, '.');
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  console.log(
    `[backfill] ${options.apply ? 'APPLY' : 'DRY RUN'} ${options.from}..${options.to}`
  );
  console.log('[backfill] User reviews, comments, moments and reactions are not modified.');

  let discovered = 0;
  let ready = 0;
  let synced = 0;
  let skipped = 0;
  let ignored = 0;
  let missingReferees = 0;

  for (const date of datesBetween(options.from, options.to)) {
    const matches = await getTodayMatches(toCrawlerDate(date), { strict: true });
    if (matches.length === 0) continue;
    discovered += matches.length;

    for (const match of matches) {
      const label = `${match.year} ${match.leagueId === '1' ? 'K1' : 'K2'} R${match.roundNumber} ${match.homeTeamName} vs ${match.awayTeamName}`;
      if (match.gameStatus !== 'FE') {
        ignored += 1;
        console.log(`[backfill:ignore] status=${match.gameStatus || 'unknown'} ${label}`);
        continue;
      }
      const hasReferees = (match.sourceRefereeCount ?? 0) > 0;
      if (!hasReferees) missingReferees += 1;
      if (!options.apply) {
        if (options.sourceOnly) {
          console.log(`[backfill:source] referees=${match.sourceRefereeCount ?? 0} ${label}`);
          continue;
        }
        const matchId = await getApiMatchId(match);
        if (!matchId) {
          skipped += 1;
          console.warn(`[backfill:missing] ${label}`);
          continue;
        }
        ready += 1;
        console.log(`[backfill:ready] ${matchId} ${label}`);
        continue;
      }

      console.log(`[backfill:apply] ${label}`);
      const resolved = await syncRoundAndMatch(match, {
        allowCreate: false,
        updateFocus: false,
      });
      if (!resolved.matchId) {
        skipped += 1;
        console.warn(`[backfill:skip] Existing match not found: ${label}`);
        continue;
      }

      if (hasReferees) {
        await syncRefereeInfo(match, { strict: true, matchId: resolved.matchId });
      } else {
        console.warn(`[backfill:partial] Official referee data is empty; existing assignments preserved: ${label}`);
      }
      await syncMatchResult(match, { strict: true, matchId: resolved.matchId });
      synced += 1;
      await pause(250);
    }
  }

  console.log(
    `[backfill] discovered=${discovered} ready=${ready} synced=${synced} skipped=${skipped} ignored=${ignored} missingReferees=${missingReferees}`
  );
  if (!options.apply) {
    console.log(
      options.sourceOnly
        ? '[backfill] Source-only mode: See VAR was not queried or changed.'
        : '[backfill] No See VAR data was changed. Re-run with --apply only after skipped=0.'
    );
  }
}

main().catch((error) => {
  console.error('[backfill] failed:', error);
  process.exit(1);
});
