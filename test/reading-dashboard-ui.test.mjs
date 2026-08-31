import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function dashboardRules() {
  const css = await fs.readFile(new URL('../assets/css/blog.css', import.meta.url), 'utf8');
  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), match => ({
    selectors: match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().split(',').map(selector => selector.trim()),
    declarations: match[2]
  }));
}

async function barValueRules() {
  return (await dashboardRules()).filter(rule => rule.selectors.some(selector => selector.includes('.reading-bar-value')));
}

async function renderBars(years, selectedYear) {
  const source = await fs.readFile(new URL('../assets/js/reading-dashboard.js', import.meta.url), 'utf8');
  const window = { addEventListener() {} };
  vm.runInNewContext(source.replace(/\}\(\)\);\s*$/, [
    'window.renderBarsForTest = renderBars;',
    'window.selectYearForTest = function (year) { state.year = year; };',
    '}());'
  ].join('\n')), {
    window,
    document: { addEventListener() {} },
    setTimeout() {}
  });
  const properties = new Map();
  const chart = { innerHTML: '', style: { setProperty(name, value) { properties.set(name, value); } } };
  window.selectYearForTest(selectedYear);
  window.renderBarsForTest({ querySelector: () => chart }, { years });
  return { html: chart.innerHTML, properties };
}

test('annual reading counts are visible without interaction', async () => {
  const rules = await barValueRules();
  const defaultRule = rules.find(rule => rule.selectors.includes('.reading-bar-value'));
  assert.ok(defaultRule, 'annual count labels must have a default style');
  assert.match(defaultRule.declarations, /(?:^|;)\s*opacity\s*:\s*1\s*(?:;|$)/);
  assert.doesNotMatch(defaultRule.declarations, /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\b/);
});

test('hover, focus and year selection do not control annual count visibility', async () => {
  const rules = await barValueRules();
  const interactiveRules = rules.filter(rule => rule.selectors.some(selector =>
    /:(?:hover|focus(?:-visible|-within)?)\b|\[aria-pressed\b/.test(selector)
  ));
  for (const rule of interactiveRules) {
    assert.doesNotMatch(rule.declarations, /(?:^|;)\s*(?:opacity|visibility|display)\s*:/,
      `count visibility must not depend on ${rule.selectors.join(', ')}`);
  }
});

test('annual count labels continue to use each year record dynamically', async () => {
  const years = [{ year: 2010, entries: 4 }, { year: 2011, entries: 17 }, { year: 2012, entries: 8 }];
  const { html, properties } = await renderBars(years, 2011);
  const columns = Array.from(html.matchAll(/<span class="reading-bar-column" style="height:(\d+)%"><span class="reading-bar-value">(\d+)<\/span><i aria-hidden="true"><\/i><\/span>/g));
  assert.equal(columns.length, years.length, 'each label must belong to its dynamically sized column, not the common chart header');
  assert.deepEqual(columns.map(match => Number(match[1])), [24, 100, 47]);
  assert.deepEqual(columns.map(match => Number(match[2])), years.map(item => item.entries));
  assert.equal(properties.get('--reading-year-count'), years.length);
});

test('annual count labels are centered immediately above their own columns', async () => {
  const rules = await dashboardRules();
  const column = rules.find(rule => rule.selectors.includes('.reading-bar-column'));
  const label = rules.find(rule => rule.selectors.includes('.reading-bar-value'));
  const button = rules.find(rule => rule.selectors.includes('.reading-bars button'));
  assert.match(column.declarations, /position:\s*relative/);
  assert.match(label.declarations, /position:\s*absolute/);
  assert.match(label.declarations, /bottom:\s*calc\(100%\s*\+\s*\.2rem\)/);
  assert.match(label.declarations, /left:\s*50%/);
  assert.match(label.declarations, /transform:\s*translateX\(-50%\)/);
  assert.match(label.declarations, /line-height:\s*1\.1rem/);
  assert.match(button.declarations, /padding:\s*calc\(1\.3rem\s*\+\s*3px\)\s+0\s+0/,
    'reserve label line height, gap and hover lift so the tallest count is not clipped');
});

test('column highlights move the label with its bar without fading the label', async () => {
  const rules = await dashboardRules();
  const column = rules.find(rule => rule.selectors.includes('.reading-bar-column'));
  const decoration = rules.find(rule => rule.selectors.includes('.reading-bar-column i'));
  assert.doesNotMatch(column.declarations, /(?:^|;)\s*opacity\s*:/);
  assert.match(decoration.declarations, /opacity:\s*\.56/);
  assert.match(decoration.declarations, /height:\s*100%/);
  for (const interaction of [':hover', ':focus-visible', '[aria-pressed="true"]']) {
    const highlight = rules.find(rule => rule.selectors.includes(`.reading-bars button${interaction} .reading-bar-column`));
    assert.ok(highlight, `missing shared label/bar movement for ${interaction}`);
    assert.match(highlight.declarations, /transform:\s*translateY\(-3px\)/);
    assert.doesNotMatch(highlight.declarations, /(?:^|;)\s*opacity\s*:/);
  }
});

test('annual bars retain year selection and accessible dynamic descriptions', async () => {
  const { html } = await renderBars([{ year: 2010, entries: 4 }, { year: 2011, entries: 17 }], 2011);
  assert.match(html, /<button type="button" data-reading-year="2010" aria-pressed="false" aria-label="2010 年，4 本阅读记录">/);
  assert.match(html, /<button type="button" data-reading-year="2011" aria-pressed="true" aria-label="2011 年，17 本阅读记录">/);
  assert.match(html, /<small>2010<\/small>/);
  assert.match(html, /<small>2011<\/small>/);
});

test('mobile bar sizing applies to the shared label and bar column', async () => {
  const css = await fs.readFile(new URL('../assets/css/blog.css', import.meta.url), 'utf8');
  assert.match(css, /\.reading-bars\s*\{\s*gap:\s*\.2rem;\s*height:\s*160px;/);
  assert.match(css, /\.reading-bar-column\s*\{\s*width:\s*72%;\s*\}/);
  assert.doesNotMatch(css, /\.reading-bar-track\s+i\s*\{\s*width:\s*72%/);
});
