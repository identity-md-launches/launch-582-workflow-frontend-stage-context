import { test, expect } from '@playwright/test';
import { parseAmount, parseSlippage, validateMessage } from '../src/chain';

test('amounts reject rounding, zero, negative, nondecimal and uint256 overflow', () => {
  expect(parseAmount('1.000000000000000001', 18)).toBe(1000000000000000001n);
  for (const amount of ['0', '-1', '1e3', 'NaN', '0.0000000000000000001', (2n ** 256n).toString()]) {
    expect(() => parseAmount(amount, 18)).toThrow();
  }
});

test('message limits use Unicode scalar values and reject lone surrogates', () => {
  expect(validateMessage('')).toBe(0);
  expect(validateMessage('💛'.repeat(140))).toBe(140);
  for (const message of ['💛'.repeat(141), '\ud800', '\udfff', 'ok\ud800end']) {
    expect(() => validateMessage(message)).toThrow();
  }
});

test('slippage supports exact hundredths and rejects excessive or malformed tolerances', () => {
  expect(parseSlippage('0')).toBe(0);
  expect(parseSlippage('0.25')).toBe(25);
  expect(parseSlippage('5')).toBe(500);
  for (const slippage of ['-1', '5.01', '0.001', '1e2', '']) expect(() => parseSlippage(slippage)).toThrow();
});
