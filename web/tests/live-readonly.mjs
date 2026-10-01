// Optional network-dependent evidence capture. This script never injects a wallet,
// calls a write RPC, or clicks a transaction control.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const url = 'http://127.0.0.1:4175/preview/';
let server;
try { await fetch(url); }
catch {
  server = spawn(process.execPath, ['tests/static-server.mjs'], { stdio: 'inherit' });
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(url)).ok) break; } catch { /* Server is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const requests = new Map();
const rpcMethods = new Set();
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (request.method() === 'POST') {
    try { for (const item of [request.postDataJSON()].flat()) rpcMethods.add(item.method); } catch { /* Not JSON RPC. */ }
  }
});
page.on('response', response => requests.set(response.url(), response.status()));
page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
const report = { checkedAt: new Date().toISOString(), mode: 'Live read-only public RPC; no wallet injected; no transactions', url, status: 'pending' };
try {
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('.contracts')?.textContent?.includes('State at block'), undefined, { timeout: 50_000 });
  await page.waitForFunction(() => document.querySelector('#recent .tip-list') || document.querySelector('#recent')?.textContent?.includes('The first kind word could be yours.'), undefined, { timeout: 50_000 });
  report.status = 'passed';
  report.statistics = await page.locator('.stat').allTextContents();
  report.deployment = await page.locator('.contracts').innerText();
  report.recentTips = await page.locator('#recent').innerText();
  report.overflowDesktop = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  mkdirSync('../docs/evidence', { recursive: true });
  await page.screenshot({ path: '../docs/evidence/live-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  report.overflowMobile = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await page.screenshot({ path: '../docs/evidence/live-mobile.png', fullPage: true });
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.errors = errors;
  report.responses = [...requests].map(([url, status]) => ({ url, status }));
  report.rpcMethods = [...rpcMethods].sort();
  if (report.rpcMethods.some(method => /send|sign|wallet/i.test(method))) throw new Error('Unexpected write or wallet method in read-only capture.');
  mkdirSync('../docs/evidence', { recursive: true });
  writeFileSync('../docs/evidence/live-browser.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  server?.kill();
}
