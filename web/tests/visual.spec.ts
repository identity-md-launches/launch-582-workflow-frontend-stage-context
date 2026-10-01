import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MockChain } from './mock-chain';

test('rendered contrast, visible keyboard focus, reduced motion, and 320/768px reflow', async ({ page }) => {
  const chain = new MockChain();
  await chain.install(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send tip', exact: true })).toBeEnabled();
  await page.locator('summary').filter({ hasText: /^Swap TIPS$/ }).click();
  await page.locator('summary').filter({ hasText: /^Send TIPS$/ }).click();
  await page.mouse.move(0, 0);
  const measurements = await page.evaluate(() => {
    type RGB = [number, number, number, number];
    const rgb = (text: string): RGB => {
      const parts = text.match(/[\d.]+/g)!.map(Number);
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };
    const composite = (front: RGB, back: RGB): RGB => [
      front[0] * front[3] + back[0] * (1 - front[3]), front[1] * front[3] + back[1] * (1 - front[3]),
      front[2] * front[3] + back[2] * (1 - front[3]), 1,
    ];
    const background = (node: Element): RGB => {
      const ancestors: Element[] = [];
      for (let element: Element | null = node; element; element = element.parentElement) ancestors.unshift(element);
      return ancestors.reduce((color, element) => composite(rgb(getComputedStyle(element).backgroundColor), color), [255, 255, 255, 1] as RGB);
    };
    const luminance = (color: RGB) => color.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const ratio = (a: RGB, b: RGB) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const selectors = ['.help', '.fine', '.jar-label', '.tip-message', '.tip-meta', '.tip-amount', '.tip-sender', 'button.primary', 'label', 'input', 'body'];
    const text = selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && (selector === '.jar-label' || !element.closest('[aria-hidden="true"]')) && (selector !== '.fine' || /[\p{L}\p{N}]/u.test(element.textContent || ''))).map((element, index) => {
      const style = getComputedStyle(element);
      const back = background(element);
      const front = composite(rgb(style.color), back);
      return { selector, index, text: element.textContent?.trim().slice(0, 60), color: style.color, background: back.slice(0, 3), fontSize: style.fontSize, ratio: Number(ratio(front, back).toFixed(3)) };
    }));
    return text;
  });
  for (const measurement of measurements) expect(measurement.ratio, JSON.stringify(measurement)).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press('Tab');
  await page.getByLabel('Tip amount (ETH)', { exact: true }).focus();
  const focus = await page.getByLabel('Tip amount (ETH)', { exact: true }).evaluate(element => {
    const style = getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), color: style.outlineColor, width: style.outlineWidth, offset: style.outlineOffset, style: style.outlineStyle, borderColor: style.borderColor, inputSurface: style.backgroundColor, adjacentSurface: getComputedStyle(element.closest('.card')!).backgroundColor, pageSurface: getComputedStyle(document.documentElement).backgroundColor };
  });
  expect(focus.visible).toBe(true);
  expect(focus.width).toBe('3px');
  expect(focus.style).toBe('solid');
  const focusRatio = (foreground: string, background: string) => {
    const luminance = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const a = luminance(foreground), b = luminance(background);
    return Number(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(3));
  };
  const focusContrasts = { surface: focusRatio(focus.color, focus.adjacentSurface), page: focusRatio(focus.color, focus.pageSurface), inputBorder: focusRatio(focus.borderColor, focus.inputSurface) };
  expect(focusContrasts.surface).toBeGreaterThanOrEqual(3);
  expect(focusContrasts.page).toBeGreaterThanOrEqual(3);
  expect(focusContrasts.inputBorder).toBeGreaterThanOrEqual(3);
  mkdirSync('../docs/evidence', { recursive: true });
  await page.screenshot({ path: '../docs/evidence/keyboard-focus.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.locator('button.primary').evaluate(element => ({ mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches, transitionDuration: getComputedStyle(element).transitionDuration, animationDuration: getComputedStyle(element).animationDuration }));
  expect(motion.mediaMatches).toBe(true);
  expect(motion.transitionDuration).toBe('0s');
  expect(motion.animationDuration).toBe('0s');
  const reflow = [];
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1024 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, overflowing: document.documentElement.scrollWidth > innerWidth }));
    reflow.push(overflow);
    expect(overflow.overflowing).toBe(false);
    await page.screenshot({ path: `../docs/evidence/reflow-${width}.png`, fullPage: true });
  }
  writeFileSync('../docs/evidence/contrast.json', JSON.stringify({ measuredAt: new Date().toISOString(), browser: 'Chromium 141', method: 'Rendered computed foreground colors and alpha-composited ancestor background colors; WCAG relative luminance formula. Decorative glyph excluded; opaque jar label measured over its own surface.', measurements, focus: { ...focus, contrast: focusContrasts }, reducedMotion: motion, reflow }, null, 2) + '\n');
});
