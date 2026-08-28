import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadYearTotal() {
  const source = await fs.readFile(new URL('../assets/js/year-word-total.js', import.meta.url), 'utf8');
  const document = {
    addEventListener() {},
    querySelector() { return null; }
  };
  const window = {
    addEventListener() {},
    document,
    location: { hash: '#/' },
    setTimeout() { return 1; }
  };
  window.window = window;
  vm.runInNewContext(source, { window, Array, Math, Number, RegExp, String });
  return window.DocReadYearWordTotal;
}

test('month headings accept integer or decimal word totals', async () => {
  const api = await loadYearTotal();
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.monthFromHeading('2026-8【50万字】', 2026))),
    { month: 8, explicitWan: 50 }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.monthFromHeading('2026 年 9 月【1.5万字】', '2026'))),
    { month: 9, explicitWan: 1.5 }
  );
});

test('annual equation is rebuilt from every current month in display order', async () => {
  const api = await loadYearTotal();
  assert.equal(api.equationFromSections([
    { explicitWan: 50, nodes: [] },
    { explicitWan: 18, nodes: [] },
    { explicitWan: 56, nodes: [] },
    { explicitWan: 123, nodes: [] },
    { explicitWan: 17, nodes: [] },
    { explicitWan: 9, nodes: [] },
    { explicitWan: 44, nodes: [] }
  ]), '50+18+56+123+17+9+44=317万字');
});

test('a month without a heading total falls back to its book word counts', async () => {
  const api = await loadYearTotal();
  assert.equal(api.equationFromSections([
    { explicitWan: null, nodes: [{ textContent: '《甲》【4万】 《乙》【7万字】' }] },
    { explicitWan: 2.5, nodes: [] }
  ]), '11+2.5=13.5万字');
});
