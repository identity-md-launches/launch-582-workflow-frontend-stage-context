import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodeAbiParameters, decodeFunctionData, parseEther, parseAbiParameters } from 'viem';
import { MockChain, manifest, jar, jarAbi, token, tokenAbi, routerAbi, permitAbi, OWNER } from './mock-chain';

async function open(page: Page, options: ConstructorParameters<typeof MockChain>[0] = {}) {
  const chain = new MockChain(options);
  await chain.install(page, options);
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
  return chain;
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
}
async function tip(page: Page, message = 'Thank you 💛') {
  await page.getByLabel('Tip amount (ETH)', { exact: true }).fill('0.01');
  await page.getByLabel('Message (optional)', { exact: true }).fill(message);
}
async function expandSwap(page: Page) {
  await page.locator('summary').filter({ hasText: /^Swap TIPS$/ }).click();
}

test('static subpath, missing wallet, literal event messages, newest 20, and responsive rendering', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const chain = await open(page, { missingWallet: true });
  await expect(page.getByRole('button', { name: 'Send tip', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect to send a tip', exact: true })).toBeVisible();
  await expect(page.getByText('<img src=x onerror=alert(1)> & hello', { exact: true })).toBeVisible();
  await expect(page.getByText('Tip message 19', { exact: true })).toBeVisible();
  await expect(page.getByText('Tip message 20', { exact: true })).toHaveCount(0);
  const messages = await page.locator('[data-testid="tip-message"]').allTextContents();
  expect(messages).toHaveLength(20);
  expect(messages[0]).toBe('<img src=x onerror=alert(1)> & hello');
  expect(messages[19]).toBe('Tip message 19');
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(chain.transactions).toHaveLength(0);
  await page.screenshot({ path: '../docs/evidence/desktop.png' });
  await page.screenshot({ path: '../docs/evidence/desktop-full.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../docs/evidence/mobile.png' });
  await page.screenshot({ path: '../docs/evidence/mobile-full.png', fullPage: true });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByText(/no.*wallet|install.*wallet|wallet.*not.*found|browser wallet/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('wrong chain adds the exact handed-off network then switches before enabling writes', async ({ page }) => {
  const chain = await open(page, { wrongChain: true });
  await connect(page);
  await tip(page);
  await expect(page.getByRole('button', { name: 'Send tip', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Switch to Sepolia', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send tip', exact: true })).toBeEnabled();
  const switches = chain.walletRequests.filter(request => request.method === 'wallet_switchEthereumChain');
  expect(switches).toHaveLength(2);
  expect(switches[0].params).toEqual([{ chainId: manifest.walletAddChain.chainId }]);
  expect(chain.walletRequests.find(request => request.method === 'wallet_addEthereumChain')?.params).toEqual([manifest.walletAddChain]);
});

test('tip validates Unicode scalars, simulates, locks pending writes, and refreshes after receipt', async ({ page }) => {
  const chain = await open(page);
  await connect(page);
  await tip(page, '💛'.repeat(141));
  await page.getByRole('button', { name: 'Send tip', exact: true }).click();
  await expect(page.getByText('Keep your message to 140 characters or fewer.', { exact: true })).toBeVisible();
  expect(chain.transactions).toHaveLength(0);
  await page.getByLabel('Message (optional)', { exact: true }).fill('💛'.repeat(140));
  await expect(page.getByRole('button', { name: 'Send tip', exact: true })).toBeEnabled();
  // A lone UTF-16 surrogate cannot safely round-trip through ordinary browser typing.
  await page.getByLabel('Message (optional)', { exact: true }).evaluate((element: HTMLTextAreaElement) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, '\ud800');
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Send tip', exact: true }).click();
  await expect(page.getByText(/message contains an unsupported character/i)).toBeVisible();
  expect(chain.transactions).toHaveLength(0);
  await tip(page);
  await expandSwap(page);
  chain.holdReceipt = true;
  await page.getByRole('button', { name: 'Send tip', exact: true }).click();
  await expect.poll(() => chain.transactions.length).toBe(1);
  const tx = chain.transactions[0];
  expect(tx.to.toLowerCase()).toBe(jar.address.toLowerCase());
  expect(BigInt(tx.value)).toBe(parseEther('0.01'));
  expect(decodeFunctionData({ abi: jarAbi, data: tx.data })).toMatchObject({ functionName: 'tip', args: ['Thank you 💛'] });
  expect(chain.requests.some(request => request.method === 'eth_call' && request.params?.[0]?.data === tx.data)).toBe(true);
  await expect(page.locator('[data-testid="tip-submit"]')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Get quote', exact: true })).toBeDisabled();
  chain.holdReceipt = false;
  await expect.poll(() => chain.totalTipped).toBe(parseEther('2.76'));
  await expect(page.getByText(/confirmed/i).first()).toBeVisible();
});

test('rejected signatures and failed simulation display errors without a broadcast', async ({ page }) => {
  const chain = await open(page);
  await connect(page);
  await tip(page);
  chain.failSimulation = true;
  await page.getByRole('button', { name: 'Send tip', exact: true }).click();
  await expect(page.getByText(/test simulation denied/i).first()).toBeVisible();
  expect(chain.transactions).toHaveLength(0);
  chain.failSimulation = false;
  chain.rejectSignature = true;
  await page.getByRole('button', { name: 'Send tip', exact: true }).click();
  await expect(page.getByText(/reject|declin|cancel/i).first()).toBeVisible();
  expect(chain.transactions).toHaveLength(0);
});

test('a wallet account change during simulation blocks the signature request', async ({ page }) => {
  const chain = await open(page);
  await connect(page);
  await tip(page);
  chain.accountChangeAfterSimulation = true;
  await page.getByRole('button', { name: 'Send tip', exact: true }).click();
  await expect(page.getByText(/account changed/i).first()).toBeVisible();
  expect(chain.walletRequests.some(request => request.method === 'eth_sendTransaction')).toBe(false);
});

test('a reverted receipt is reported as failure and never as successful payment', async ({ page }) => {
  const chain = await open(page);
  await connect(page);
  await tip(page);
  chain.revertReceipt = true;
  await page.getByRole('button', { name: 'Send tip', exact: true }).click();
  await expect(page.getByText(/transaction reverted/i).first()).toBeVisible();
  expect(chain.totalTipped).toBe(parseEther('2.75'));
});

test('confirmation timeout preserves the hash and locks writes until receipt recovery', async ({ page }) => {
  await page.clock.install();
  const chain = await open(page);
  await connect(page);
  await tip(page);
  chain.holdReceipt = true;
  await page.getByRole('button', { name: 'Send tip', exact: true }).click();
  await expect.poll(() => chain.requests.some(request => request.method === 'eth_getTransactionReceipt')).toBe(true);
  await page.clock.fastForward(180_001);
  await expect(page.getByText(/confirmation is still unknown/i)).toBeVisible();
  await expect(page.locator('[data-testid="tip-submit"]')).toBeDisabled();
  await expect(page.getByRole('link', { name: 'View transaction', exact: false })).toHaveAttribute('href', /\/tx\/0x[0-9a-f]{64}$/);
  chain.holdReceipt = false;
  await page.getByRole('button', { name: 'Check transaction status', exact: true }).click();
  await expect(page.getByText('Transaction confirmed.', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send tip', exact: true })).toBeEnabled();
  expect(chain.transactions).toHaveLength(1);
});

test('only owner sees withdrawal, and confirmation refreshes the withdrawable balance', async ({ page }) => {
  const chain = await open(page, { owner: true });
  await connect(page);
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect.poll(() => chain.withdrawn).toBe(true);
  expect(decodeFunctionData({ abi: jarAbi, data: chain.transactions[0].data }).functionName).toBe('withdraw');
  await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toBeDisabled();
});

test('native buy quotes, applies slippage, preserves pool key, simulates, and sends ETH only', async ({ page }) => {
  const chain = await open(page);
  await connect(page);
  await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0);
  await expandSwap(page);
  await page.getByLabel('Swap amount', { exact: true }).fill('0.1');
  await page.getByLabel('Slippage (%)', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Get quote', exact: true }).click();
  await page.getByRole('button', { name: 'Swap ETH for TIPS', exact: true }).click();
  await expect.poll(() => chain.transactions.length).toBe(1);
  const tx = chain.transactions[0];
  expect(tx.to.toLowerCase()).toBe(manifest.network.uniswapV4.universalRouter.toLowerCase());
  expect(BigInt(tx.value)).toBe(parseEther('0.1'));
  const decoded = decodeFunctionData({ abi: routerAbi, data: tx.data });
  const [commands, inputs, deadline] = decoded.args!;
  expect(commands).toBe('0x10');
  expect(Number(deadline)).toBeGreaterThan(Date.now() / 1000);
  expect(Number(deadline)).toBeLessThan(Date.now() / 1000 + 1801);
  const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes, bytes[]'), inputs[0]);
  expect(actions).toBe('0x060c0f');
  const [swap] = decodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'), params[0]);
  expect(swap.poolKey.currency0.toLowerCase()).toBe(manifest.poolKey.currency0);
  expect(swap.poolKey.currency1.toLowerCase()).toBe(manifest.poolKey.currency1);
  expect(swap.poolKey.hooks.toLowerCase()).toBe(manifest.poolKey.hooks);
  expect(swap.poolKey.fee).toBe(manifest.poolKey.fee);
  expect(swap.poolKey.tickSpacing).toBe(manifest.poolKey.tickSpacing);
  expect(swap.zeroForOne).toBe(true);
  expect(swap.amountIn).toBe(parseEther('0.1'));
  expect(swap.amountOutMinimum).toBe(parseEther('24.75'));
  const [settleCurrency, settleAmount] = decodeAbiParameters(parseAbiParameters('address,uint256'), params[1]);
  const [takeCurrency, takeAmount] = decodeAbiParameters(parseAbiParameters('address,uint256'), params[2]);
  expect(settleCurrency.toLowerCase()).toBe(manifest.poolKey.currency0);
  expect(settleAmount).toBe(parseEther('0.1'));
  expect(takeCurrency.toLowerCase()).toBe(token.address);
  expect(takeAmount).toBe(swap.amountOutMinimum);
  expect(chain.requests.some(request => request.method === 'eth_call' && request.params?.[0]?.data === tx.data)).toBe(true);
  expect(chain.transactions.some(transaction => transaction.to.toLowerCase() === manifest.network.uniswapV4.permit2.toLowerCase())).toBe(false);
});

test('token sell requires separate exact-amount token and Permit2 approvals before execute', async ({ page }) => {
  const chain = await open(page);
  await connect(page);
  await expandSwap(page);
  await page.getByLabel('Direction', { exact: true }).selectOption({ label: 'Sell TIPS' });
  await page.getByLabel('Swap amount', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Get quote', exact: true }).click();
  await page.getByRole('button', { name: 'Approve TIPS to Permit2', exact: true }).click();
  await expect.poll(() => chain.approvedToken).toBe(true);
  const first = chain.transactions[0];
  const approval = decodeFunctionData({ abi: tokenAbi, data: first.data });
  expect(first.to.toLowerCase()).toBe(token.address.toLowerCase());
  expect(approval.functionName).toBe('approve');
  expect((approval.args![0] as string).toLowerCase()).toBe(manifest.network.uniswapV4.permit2.toLowerCase());
  expect(approval.args![1]).toBe(parseEther('5'));
  await page.getByRole('button', { name: 'Approve router', exact: true }).click();
  await expect.poll(() => chain.approvedPermit).toBe(true);
  await page.getByRole('button', { name: 'Swap TIPS for ETH', exact: true }).click();
  await expect.poll(() => chain.transactions.length).toBe(3);
  expect(chain.transactions[1].to.toLowerCase()).toBe(manifest.network.uniswapV4.permit2.toLowerCase());
  const permit = decodeFunctionData({ abi: permitAbi, data: chain.transactions[1].data });
  expect(permit.functionName).toBe('approve');
  expect((permit.args![0] as string).toLowerCase()).toBe(token.address.toLowerCase());
  expect((permit.args![1] as string).toLowerCase()).toBe(manifest.network.uniswapV4.universalRouter.toLowerCase());
  expect(permit.args![2]).toBe(parseEther('5'));
  expect(Number(permit.args![3])).toBeGreaterThan(Date.now() / 1000 + 1700);
  expect(Number(permit.args![3])).toBeLessThan(Date.now() / 1000 + 1801);
  expect(chain.transactions[2].to.toLowerCase()).toBe(manifest.network.uniswapV4.universalRouter.toLowerCase());
  expect(BigInt(chain.transactions[2].value || '0x0')).toBe(0n);
});

test('token transfer rejects the zero address and sends exact token units to a valid recipient', async ({ page }) => {
  const chain = await open(page);
  await connect(page);
  await page.locator('summary').filter({ hasText: /^Send TIPS$/ }).click();
  await page.getByLabel('Recipient address', { exact: true }).fill('0x0000000000000000000000000000000000000000');
  await page.getByLabel('Amount (TIPS)', { exact: true }).fill('1.5');
  await page.locator('button').filter({ hasText: /^Send TIPS$/ }).click();
  await expect(page.getByText(/valid, nonzero Ethereum recipient/i)).toBeVisible();
  expect(chain.transactions).toHaveLength(0);
  await page.getByLabel('Recipient address', { exact: true }).fill(OWNER);
  await page.locator('button').filter({ hasText: /^Send TIPS$/ }).click();
  await expect.poll(() => chain.transactions.length).toBe(1);
  expect(chain.transactions[0].to.toLowerCase()).toBe(token.address.toLowerCase());
  expect(decodeFunctionData({ abi: tokenAbi, data: chain.transactions[0].data })).toMatchObject({ functionName: 'transfer', args: [OWNER, parseEther('1.5')] });
  expect(BigInt(chain.transactions[0].value || 0)).toBe(0n);
});

test('ABI tampering blocks deployment readiness and transaction controls', async ({ page }) => {
  const chain = new MockChain();
  await chain.install(page);
  await page.route(`**/${jar.abiPath}`, route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('./');
  await expect(page.getByText(/hash|verification|integrity/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect to send a tip', exact: true })).toBeDisabled();
  expect(chain.transactions).toHaveLength(0);
});

test('connected controls pass axe WCAG checks and keyboard focus begins with skip navigation', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await connect(page);
  await expandSwap(page);
  await page.locator('summary').filter({ hasText: /^Send TIPS$/ }).click();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  mkdirSync('../docs/evidence', { recursive: true });
  writeFileSync('../docs/evidence/accessibility.json', JSON.stringify({
    testedAt: new Date().toISOString(), url: result.url, engine: result.testEngine,
    viewport: page.viewportSize(), state: 'Connected mocked visitor; swap and transfer controls expanded',
    tags: ['wcag2a', 'wcag2aa', 'wcag21aa'],
    passes: result.passes.map(rule => rule.id),
    incomplete: result.incomplete.map(rule => ({ id: rule.id, description: rule.description, nodes: rule.nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary })) })),
    violations: result.violations.map(rule => ({ id: rule.id, impact: rule.impact, description: rule.description, nodes: rule.nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary })) })),
  }, null, 2) + '\n');
  expect(result.violations).toEqual([]);
});
