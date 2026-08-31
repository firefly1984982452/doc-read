import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../scripts/check-site.mjs', import.meta.url), 'utf8');
const versionCheck = source.split('\n').find(line => line.includes('index.html must use the generated content-based asset version'));
assert.ok(versionCheck, 'site checker must keep its legacy asset version guard');

function rejectsVersion(value) {
  const errors = [];
  vm.runInNewContext(versionCheck, { indexHtml: `<link href="./assets/css/blog.css?v=${value}">`, errors });
  return errors.length > 0;
}

test('asset version guard accepts content hashes starting with eight digits', () => {
  assert.equal(rejectsVersion('08331699ed'), false);
  assert.equal(rejectsVersion('08331699ed&theme=light'), false);
  assert.equal(rejectsVersion('1234567890'), false);
});

test('asset version guard still rejects complete legacy date and placeholder values', () => {
  for (const value of ['20260831', 'build', '20260831&theme=light', 'build#section']) {
    assert.equal(rejectsVersion(value), true, `must reject legacy version ${value}`);
  }
});
