// Inspect the built English interface in an isolated iframe; no real EDA calls.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const base = process.env.EASYEDA_BRIDGE_URL || 'http://127.0.0.1:49620';
const health = await fetch(base + '/health').then(r => r.json());
assert.equal(health.service, 'easyeda-bridge');
assert.equal(health.edaConnected, true);
const windows = await fetch(base + '/eda-windows').then(r => r.json());
const html = readFileSync(new URL('./build/iframe/index.html', import.meta.url), 'utf8');
for (const name of ['main.js', 'linter.js', 'recorder.js', 'hybrid.js', 'iframe/index.html', 'iframe/app.template.js', 'extension.json', 'README.md', 'README.en.md', 'CHANGELOG.md']) {
  assert.ok(!/\p{Script=Han}/u.test(readFileSync(new URL(name, import.meta.url), 'utf8')), 'Unexpected Chinese interface text in ' + name);
}
async function inspect(html, action) {
  const d = window.parent.document;
  const id = 'circuit-studio-english-ui-preview';
  const previous = d.getElementById(id);
  if (action === 'remove') { previous?.remove(); return { removed: true }; }
  if (action === 'recorder' || action === 'hybrid' || action === 'lint') {
    const frame = previous.querySelector('iframe');
    frame.contentDocument.querySelector('[data-mode="' + action + '"]').click();
    return { mode: action };
  }
  previous?.remove();
  const box = d.createElement('div'); box.id = id;
  box.style.cssText = 'position:fixed;left:20px;top:55px;z-index:2147483647;background:#101010;border:2px solid #6366f1;';
  const label = d.createElement('div');
  label.textContent = 'Circuit Studio v1.2.21 — isolated interface preview (no experiment data)';
  label.style.cssText = 'padding:6px 12px;color:#fff;font:13px Arial;background:#3730a3;';
  const frame = d.createElement('iframe');
  frame.style.cssText = 'display:block;width:1000px;height:650px;border:0;';
  box.append(label, frame); d.body.appendChild(box);
  await new Promise(resolve => { frame.onload = resolve; frame.srcdoc = html; });
  Object.defineProperty(frame.contentWindow, 'eda', { value: {}, configurable: true });
  const result = [];
  for (const width of [620, 1000]) {
    frame.style.width = width + 'px';
    for (const mode of ['lint', 'recorder', 'hybrid']) {
      const doc = frame.contentDocument;
      doc.querySelector('[data-mode="' + mode + '"]').click();
      const elements = Array.from(doc.querySelectorAll('.toolbar, .btn, .capture-status, .hybrid-card, .note-input'));
      const overflow = elements.filter(node => node.getClientRects().length).filter(node => {
        const r = node.getBoundingClientRect(); return r.left < -0.5 || r.right > width + 0.5;
      }).map(node => node.id || node.className);
      result.push({ width, mode, overflow, bodyOverflow: doc.documentElement.scrollWidth > width,
        unexpectedChinese: /\p{Script=Han}/u.test(doc.body.innerText), version: doc.getElementById('brand-version').textContent });
    }
  }
  for (const button of frame.contentDocument.querySelectorAll('.btn')) button.disabled = true;
  return { cases: result, actualCircuitApiCalls: 0, preview: true };
}
const response = await fetch(base + '/execute', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ windowId: windows.activeWindowId, code: `return await (${inspect.toString()})(${JSON.stringify(html)}, ${JSON.stringify(process.argv[2] || 'inspect')});` }),
  signal: AbortSignal.timeout(20000)
});
const result = await response.json();
assert.equal(response.ok && result.success, true, JSON.stringify(result));
if (result.result.cases) {
  for (const entry of result.result.cases) {
    assert.deepEqual(entry.overflow, [], JSON.stringify(entry));
    assert.equal(entry.bodyOverflow, false, JSON.stringify(entry));
    assert.equal(entry.unexpectedChinese, false, JSON.stringify(entry));
    assert.equal(entry.version, 'v1.2.21');
  }
  writeFileSync(new URL('./english-ui-validation.json', import.meta.url), JSON.stringify(result.result, null, 2) + '\n');
}
console.log(JSON.stringify(result.result));
