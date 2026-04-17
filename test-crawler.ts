import { chromium } from 'playwright';

async function testCrawler() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.kleague.com/schedule.do');
  await page.waitForLoadState('networkidle');

  // KR: "현재", EN: "TODAY" — 달력을 오늘이 포함된 월로 맞춤
  const currentMonthBtn = page.locator('button:has-text("현재"), button:has-text("TODAY")').first();
  if (await currentMonthBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await currentMonthBtn.click();
    await page.waitForLoadState('networkidle');
  }

  const result = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#scheduleList > tr'));
    return rows.map(tr => (tr as HTMLElement).innerText);
  });
  console.log("Rows:");
  result.forEach(r => console.log(r.replace(/\n/g, ' ')));

  await browser.close();
}

testCrawler();
