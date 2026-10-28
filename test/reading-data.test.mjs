import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBookMetadata,
  noteMetadata,
  normalizeReadingPath,
  parseLibraryPreferences,
  parseYear
} from '../scripts/lib/reading-data.mjs';

test('normalizeReadingPath removes route decoration consistently', () => {
  assert.equal(normalizeReadingPath('/docs/read/《测试》.md?id=章节'), 'docs/read/《测试》');
  assert.equal(normalizeReadingPath('docs/read/《测试》'), 'docs/read/《测试》');
});

test('noteMetadata derives title, date and category from Markdown sources', () => {
  const categories = new Map([['docs/read/《测试》', '文学类']]);
  const metadata = noteMetadata('# 《测试》\n\ndate: 2026-08-14 08:00:00\n', 'docs/read/《测试》.md', categories);
  assert.deepEqual(metadata, {
    id: 'docs/read/《测试》',
    path: '/docs/read/《测试》',
    title: '《测试》',
    date: '2026-08-14',
    preference: '文学类'
  });
});

test('parseLibraryPreferences uses the library hierarchy as category metadata', () => {
  const categories = parseLibraryPreferences([
    '## 外国文学',
    '### 世界名著',
    '- [《测试》](/docs/read/《测试》.md)',
    '## 思维与生活',
    '### 习惯、学习与阅读',
    '- [《方法》](/docs/read/《方法》.md)'
  ].join('\n'));
  assert.equal(categories.get('docs/read/《测试》'), '文学类');
  assert.equal(categories.get('docs/read/《方法》'), '方法类');
});

test('parseYear calculates monthly records, word totals and stable book ids', () => {
  const markdown = [
    '# 2026年阅读书籍列表',
    '',
    '## 总字数',
    '',
    '99=99万字',
    '',
    '## 2026-2【3万字】',
    '',
    '- [① 📖《测试》作者甲【3万】](/docs/read/《测试》.md)',
    '',
    '## 2026-1【2万字】',
    '',
    '- [① 📖《方法》作者乙【2万】](/docs/read/《方法》.md)'
  ].join('\n');
  const parsed = parseYear(markdown, 2026, new Map([['docs/read/《测试》', '文学类']]));
  assert.equal(parsed.entries, 2);
  assert.equal(parsed.wordWan, 5);
  assert.equal(parsed.wordEquation, '3+2=5万字');
  assert.equal(parsed.calculatedWordWan, 5);
  assert.equal(parsed.months[0], 1);
  assert.equal(parsed.months[1], 1);
  assert.equal(parsed.records[0].bookId, 'docs/read/《测试》');
  assert.equal(parsed.records[0].author, '作者甲');
});

test('parseYear rejects a reading record outside a month section', () => {
  assert.throws(
    () => parseYear('- [《测试》【3万】](/docs/read/《测试》.md)', 2026),
    /未归入有效月份/
  );
});

test('partial readings count only the read words in annual data and book metadata', () => {
  const parsed = parseYear([
    '## 2026-10',
    '- [① 📖《白痴》作者甲【10/50万，读完】](/docs/read/《白痴》.md)',
    '- [② 📖《整本》作者乙【5万】](/docs/read/《整本》.md)',
    '## 2026-9',
    '- [① 📖《金字塔原理》作者丙【10/30万】](/docs/read/《金字塔原理》.md)',
    '- [② 📖《另一整本》作者丁【19万】](/docs/read/《另一整本》.md)'
  ].join('\n'), 2026);
  assert.equal(parsed.entries, 4);
  assert.equal(parsed.wordWan, 44);
  assert.equal(parsed.wordEquation, '15+29=44万字');
  assert.deepEqual(parsed.records.map((record) => record.wordWan), [10, 5, 10, 19]);
  const books = buildBookMetadata([], [parsed]);
  for (const title of ['《白痴》', '《金字塔原理》']) {
    const book = books.find((item) => item.title === title);
    assert.equal(book.wordWan, 10);
    assert.equal(book.readings[0].wordWan, 10);
  }
});

test('partial word counts allow decimal values and spaces without counting the denominator', () => {
  const parsed = parseYear([
    '## 2026-1',
    '- [《部分》作者【 0.5 / 2.5 万字，停止阅读 】](/docs/read/《部分》.md)',
    '- [《完整》作者【0.25万字】](/docs/read/《完整》.md)'
  ].join('\n'), 2026);
  assert.equal(parsed.wordWan, 0.75);
  assert.deepEqual(parsed.records.map((record) => record.wordWan), [0.5, 0.25]);
});

test('buildBookMetadata merges note and annual metadata without duplication', () => {
  const notes = [{
    id: 'docs/read/《测试》',
    path: '/docs/read/《测试》',
    title: '《测试》',
    date: '2026-08-14',
    preference: '文学类'
  }];
  const years = [{ records: [{
    bookId: 'docs/read/《测试》',
    path: '/docs/read/《测试》',
    title: '《测试》',
    author: '作者甲',
    preference: '文学类',
    wordWan: 3,
    year: 2026,
    month: 8
  }] }];
  const books = buildBookMetadata(notes, years);
  assert.equal(books.length, 1);
  assert.equal(books[0].author, '作者甲');
  assert.equal(books[0].wordWan, 3);
  assert.deepEqual(books[0].readings, [{ year: 2026, month: 8, wordWan: 3 }]);
});

test('note metadata preserves month precision and never invents an unknown date', () => {
  assert.equal(noteMetadata('# 标题\ndate: 2023-02\n', 'docs/read/example.md').date, '2023-02');
  assert.equal(noteMetadata('# 标题\ndate: unknown\n', 'docs/read/example.md').date, null);
  assert.equal(noteMetadata('# 标题\ndate: 2023-04-28 13:42:18\n', 'docs/read/example.md').date, '2023-04-28');
});
