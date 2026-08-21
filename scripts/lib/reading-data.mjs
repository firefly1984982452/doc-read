export function normalizeReadingPath(value) {
  return String(value || '')
    .split(/[?#]/)[0]
    .replace(/^\//, '')
    .replace(/\.md$/, '');
}

export function noteMetadata(markdown, relativePath, libraryPreferences = new Map()) {
  const normalized = normalizeReadingPath(relativePath);
  const fallback = normalized.split('/').at(-1) || normalized;
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]
    ?.replace(/[*_`]/g, '')
    .trim() || fallback;
  const date = markdown.match(/^date:\s*(\d{4}-\d{2}-\d{2})/mi)?.[1] || null;
  return {
    id: normalized,
    path: `/${normalized}`,
    title,
    date,
    preference: libraryPreferences.get(normalized) || ''
  };
}

function preferenceCategory(section, subsection) {
  if (/中国文学|外国文学/.test(section)) return '文学类';
  if (/古文典籍/.test(section)) return '历史典籍';
  if (/习惯|学习|阅读/.test(subsection)) return '方法类';
  if (/思维|心理|关系/.test(subsection)) return '思维心理';
  return '';
}

export function parseLibraryPreferences(markdown) {
  const categories = new Map();
  let section = '';
  let subsection = '';

  for (const line of markdown.split('\n')) {
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^###\s+(.+)/);
    if (h2) {
      section = h2[1].trim();
      subsection = '';
    }
    if (h3) subsection = h3[1].trim();

    const category = preferenceCategory(section, subsection);
    if (!category) continue;
    for (const match of line.matchAll(/\[[^\]]+\]\((\/docs\/(?:read|read-history)\/[^)]+?)(?:\.md)?\)/g)) {
      categories.set(normalizeReadingPath(match[1]), category);
    }
  }

  return categories;
}

export function inferPreference(record, libraryPreferences) {
  const known = libraryPreferences.get(normalizeReadingPath(record.path));
  if (known) return known;

  const value = `${record.title} ${record.author} ${record.path}`;
  if (/史记|汉书|后汉书|二十四史|黄帝内经|庄子|春秋|翦商|历史|中华史|明朝|太平公主/.test(value)) return '历史典籍';
  if (/多囊|暴食|控糖|养阳气|好牙|身体|肠子|健康|自控力|习惯|练习|学习|阅读|自学|成长|高效能|最重要的事|时间|整理|职业|方法|指南/.test(value)) return '方法类';
  if (/思考|心流|心理|亲密关系|非暴力沟通|原生家庭|认知|心智|人生的智慧|身份的焦虑|跳出自我|事实|多巴胺/.test(value)) return '思维心理';
  if (/生活|家庭|教育|孩子|玩具|带夫修行/.test(value)) return '生活教育';
  if (/《[^》]+》/.test(record.title)) return '文学类';
  return '其他';
}

export function parseYear(markdown, year, libraryPreferences = new Map()) {
  const months = Array(12).fill(0);
  const wordMonths = new Map();
  const records = [];
  let currentMonth = null;
  const declaredEquationMatch = markdown.match(/^(\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*=(\d+(?:\.\d+)?)万字)\s*$/m);

  for (const line of markdown.split('\n')) {
    const monthMatch = line.match(new RegExp(`^##\\s+${year}-(\\d{1,2})(?!\\d)`));
    if (monthMatch) {
      currentMonth = Number(monthMatch[1]);
      if (!wordMonths.has(currentMonth)) wordMonths.set(currentMonth, { explicit: null, books: 0 });
      const monthWordMatch = line.match(/【\s*(\d+(?:\.\d+)?)\s*万字?\s*】/);
      if (monthWordMatch) wordMonths.get(currentMonth).explicit = Number(monthWordMatch[1]);
      continue;
    }

    const recordMatch = line.match(/^\s*-\s+\[([^\n]+?)\]\((\/docs\/(?:read|read-history)\/[^)]+?)(?:\.md)?\)\s*$/);
    if (!recordMatch) continue;
    if (!Number.isInteger(currentMonth) || currentMonth < 1 || currentMonth > 12) {
      throw new Error(`${year} 年存在未归入有效月份的阅读记录：${line.trim()}`);
    }

    months[currentMonth - 1] += 1;
    const label = recordMatch[1].replace(/[①②③④⑤⑥⑦⑧⑨⑩📖\u200b⭐️]/g, '').trim();
    const bookWordMatch = label.match(/【\s*(\d+(?:\.\d+)?)\s*万(?:字)?(?:[^】]*)】/);
    const wordWan = bookWordMatch ? Number(bookWordMatch[1]) : null;
    if (wordWan !== null) wordMonths.get(currentMonth).books += wordWan;

    const titleMatch = label.match(/《[^》]+》/);
    const title = titleMatch ? titleMatch[0] : label.replace(/【[^】]*】/g, '').trim();
    const author = titleMatch
      ? label.slice(label.indexOf(title) + title.length).replace(/【[^】]*】/g, '').trim()
      : '';
    const record = {
      bookId: normalizeReadingPath(recordMatch[2]),
      year,
      month: currentMonth,
      title,
      author,
      wordWan,
      path: recordMatch[2]
    };
    record.preference = inferPreference(record, libraryPreferences);
    records.push(record);
  }

  const wordParts = [...wordMonths.values()]
    .map((item) => typeof item.explicit === 'number' ? item.explicit : item.books)
    .filter((value) => value > 0);
  const calculatedWordWan = wordParts.length ? wordParts.reduce((sum, value) => sum + value, 0) : null;
  const declaredWordWan = declaredEquationMatch ? Number(declaredEquationMatch[2]) : null;
  const wordWan = declaredWordWan ?? calculatedWordWan;

  return {
    year,
    entries: records.length,
    wordWan,
    wordEquation: declaredEquationMatch?.[1] || (wordParts.length ? `${wordParts.join('+')}=${wordWan}万字` : ''),
    calculatedWordWan,
    months,
    records
  };
}

export function buildBookMetadata(notes, years) {
  const books = new Map(notes.map((note) => [note.id, {
    ...note,
    author: '',
    wordWan: null,
    readings: []
  }]));

  for (const annual of years) {
    for (const record of annual.records) {
      const id = record.bookId || normalizeReadingPath(record.path);
      const book = books.get(id) || {
        id,
        path: `/${id}`,
        title: record.title,
        date: null,
        preference: record.preference || '',
        author: '',
        wordWan: null,
        readings: []
      };
      if (!book.author && record.author) book.author = record.author;
      if (typeof record.wordWan === 'number') book.wordWan = record.wordWan;
      if (!book.preference && record.preference) book.preference = record.preference;
      book.readings.push({ year: record.year, month: record.month, wordWan: record.wordWan });
      books.set(id, book);
    }
  }

  return [...books.values()].sort((a, b) =>
    a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id, 'zh-CN')
  );
}
