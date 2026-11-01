import cron from 'node-cron';
import { nowKST } from './lib/scraper';
import { loadToday, pollTick, reconcileToday } from './lib/poller';

// 서버 타임존과 상관없이 KST 기준으로 돈다
const KST = { timezone: 'Asia/Seoul' };

// 새벽 02:22: 오늘 경기 목록을 받아 라운드 포커스·경기 일정을 맞추고 추적을 시작한다
cron.schedule('22 2 * * *', () => loadToday(), KST);

// 매분: 심판 명단·스코어·상태·카드 확인. 확인할 경기가 없으면 아무 요청도 보내지 않는다
cron.schedule('* * * * *', () => pollTick(), KST);

// 23:20: 오늘 경기를 한 번 더 확인해 놓친 값을 맞춘다
cron.schedule('20 23 * * *', () => reconcileToday(), KST);

// 하루 중간에 재시작돼도 오늘 경기를 다시 추적하고, 이미 시작한 경기는 바로 한 번 맞춘다
console.log(`[${nowKST()}] Crawler started. Initializing...`);
loadToday().then(() => reconcileToday());
