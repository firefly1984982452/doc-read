import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTypoCorrections, detectTypos, typoRules } from '../scripts/lib/typo-rules.mjs';

test('detectTypos reports exact Markdown line and suggestion', () => {
  const source = '# 标题\n\n这件事即然开始了，就应该再接再励。\n';
  const issues = detectTypos(source);
  assert.deepEqual(issues.map(issue => [issue.wrong, issue.correct, issue.line]), [
    ['即然', '既然', 3],
    ['再接再励', '再接再厉', 3]
  ]);
});

test('detectTypos ignores fenced code, inline code and URLs', () => {
  const source = '```text\n即然\n```\n`再接再励`\nhttps://example.com/世外桃园\n';
  assert.equal(detectTypos(source).length, 0);
});

test('applyTypoCorrections changes only selected rules', () => {
  const source = '即然如此，也要再接再励。';
  const selected = typoRules.filter(rule => rule.wrong === '即然').map(rule => rule.id);
  assert.equal(applyTypoCorrections(source, selected), '既然如此，也要再接再励。');
});

test('applyTypoCorrections preserves ignored code and URL occurrences', () => {
  const source = '正文即然如此。\n`代码即然如此`\nhttps://example.com/即然\n';
  const selected = typoRules.filter(rule => rule.wrong === '即然').map(rule => rule.id);
  assert.equal(
    applyTypoCorrections(source, selected),
    '正文既然如此。\n`代码即然如此`\nhttps://example.com/即然\n'
  );
});

test('expanded dictionary catches a real typo from the reading notes', () => {
  const issues = detectTypos('泡一杯薄菏茶。');
  assert.deepEqual(issues.map(issue => [issue.wrong, issue.correct, issue.label]), [
    ['薄菏', '薄荷', '常见错别字']
  ]);
});

test('pattern rules detect Chinese punctuation and unmatched book-title marks', () => {
  const source = '读书,使人清醒，，也使人坚定。\n![黄帝内经》-配图](./cover.png)';
  const issues = detectTypos(source);
  assert.deepEqual(issues.map(issue => [issue.wrong, issue.correct, issue.label]), [
    ['书,', '书，', '中英文标点混用'],
    ['，，', '，', '重复标点'],
    ['![黄帝内经》', '![《黄帝内经》', '书名号不配对']
  ]);
});

test('Markdown link destinations are ignored while visible labels are checked', () => {
  const source = '[即然开始](./即然开始.md)\n![即然配图](./即然图片.png)';
  const issues = detectTypos(source);
  assert.deepEqual(issues.map(issue => issue.wrong), ['即然', '即然']);
  assert.deepEqual(issues.map(issue => issue.column), [2, 3]);
});

test('every literal rule is detectable and can be corrected', () => {
  const literalRules = typoRules.filter(rule => rule.kind === 'literal');
  const source = literalRules.map(rule => rule.wrong).join('\n');
  const issues = detectTypos(source).filter(issue => issue.kind === 'literal');
  assert.equal(issues.length, literalRules.length);
  assert.equal(
    applyTypoCorrections(source, literalRules.map(rule => rule.id)),
    literalRules.map(rule => rule.correct).join('\n')
  );
});
