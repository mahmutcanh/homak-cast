const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Keep the settings file out of the real profile.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cast_brand_'));
process.env.APPDATA = tmp;

const { normalizeCompanyName, DEFAULT_COMPANY_NAME, loadSettings, saveSettings } = require('../server/config');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

check('trims and collapses whitespace', () => {
  assert.strictEqual(normalizeCompanyName('  Acme    Corp  '), 'Acme Corp');
});
check('control characters and newlines become spaces', () => {
  assert.strictEqual(normalizeCompanyName('a\nb\tc'), 'a b c');
});
check('empty / non-string falls back to the default brand', () => {
  assert.strictEqual(normalizeCompanyName(''), DEFAULT_COMPANY_NAME);
  assert.strictEqual(normalizeCompanyName('   '), DEFAULT_COMPANY_NAME);
  assert.strictEqual(normalizeCompanyName(null), DEFAULT_COMPANY_NAME);
  assert.strictEqual(normalizeCompanyName({ a: 1 }), DEFAULT_COMPANY_NAME);
});
check('is capped at 60 characters', () => {
  assert.strictEqual(normalizeCompanyName('A'.repeat(100)).length, 60);
});
check('default settings carry the default company', () => {
  assert.strictEqual(loadSettings().companyName, DEFAULT_COMPANY_NAME);
});
check('saveSettings normalizes and persists the company name', () => {
  const saved = saveSettings({ companyName: '  Acme   Corp ' });
  assert.strictEqual(saved.companyName, 'Acme Corp');
  assert.strictEqual(loadSettings().companyName, 'Acme Corp');
  assert.strictEqual(saveSettings({ companyName: '' }).companyName, DEFAULT_COMPANY_NAME);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`test_brand: ${passed}/6 passed`);
