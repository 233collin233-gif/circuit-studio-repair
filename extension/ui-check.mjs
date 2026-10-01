// Run after build.mjs: node ui-check.mjs
// Exercises the shipped iframe in EasyEDA's browser using an isolated fake API.
// No real circuit API is invoked and the temporary iframe is always removed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bridge = process.env.EASYEDA_BRIDGE_URL || 'http://127.0.0.1:49620';
const html = readFileSync(new URL('./build/iframe/index.html', import.meta.url), 'utf8');
assert.ok(html.includes('function finalizeHybrid'), 'Build the final iframe before running UI checks');
const health = await fetch(bridge + '/health').then(response => response.json());
assert.equal(health.service, 'easyeda-bridge');
assert.equal(health.edaConnected, true, 'EasyEDA bridge must be connected');
const windows = await fetch(bridge + '/eda-windows').then(response => response.json());
assert.ok(windows.activeWindowId, 'An active EasyEDA window is required');

async function checkBuiltInterface(html) {
  const parentDoc = window.parent.document;
  const frame = parentDoc.createElement('iframe');
  frame.id = 'circuit-studio-ui-check-' + Date.now();
  frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:1000px;height:800px;border:0;';
  const passes = [], lintCalls = [], exports = [], downloads = [], listeners = new Map();
  // The editor may be a background Electron page. MessageChannel yields to
  // UI/microtasks without the browser's one-minute background timer clamp.
  const nextTask = () => new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const same = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected), message);
  let browserWindow;
  try {
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Temporary iframe did not load')), 8000);
      frame.onload = () => { clearTimeout(timer); resolve(); };
    });
    frame.srcdoc = html;
    parentDoc.body.appendChild(frame);
    await loaded;
    const w = browserWindow = frame.contentWindow, d = frame.contentDocument;
    const $ = id => { const element = d.getElementById(id); assert(element, 'Missing UI element ' + id); return element; };
    const waitFor = async (predicate, message) => {
      const deadline = Date.now() + 6000;
      while (true) {
        if (predicate()) return;
        if (Date.now() >= deadline) break;
        await nextTask();
      }
      throw new Error(message + '; UI status: ' + $('status-label').textContent
        + '; recorder: ' + $('rec-label').textContent + ' / ' + $('rec-sub').textContent
        + '; buttons: ' + JSON.stringify(['btn-rec-start', 'btn-rec-stop', 'btn-rec-export', 'btn-hybrid-start'].map(id => [id, $(id).disabled])));
    };
    const click = id => {
      assert(!$(id).disabled, 'Button unexpectedly disabled: ' + id);
      $(id).click();
    };
    let endpoint = { x: 100, y: -100 }, version = 0, failLint = false;
    const record = (type, id, body) => [id ? { type, id } : { type }, body];
    const source = () => [
      record('DOCHEAD', null, { docType: 'SCH_PAGE', uuid: 'ui-test-sheet', client: 'test-' + (++version), version }),
      record('CANVAS', 'CANVAS', { originX: 0, originY: 0 }),
      record('COMPONENT', 'component-R1', { partId: 'part-R1', x: 100, y: -100, rotation: 0, isMirror: false }),
      record('ATTR', 'attr-designator', { parentId: 'component-R1', key: 'Designator', value: 'R1' }),
      record('ATTR', 'attr-name', { parentId: 'component-R1', key: 'Name', value: 'Test Resistor' }),
      record('WIRE', 'wire-1', { zIndex: 1 }),
      record('LINE', 'wire-line', { lineGroup: 'wire-1', startX: 0, startY: 0, endX: endpoint.x, endY: endpoint.y })
    ].map(([header, body]) => JSON.stringify(header) + '||' + JSON.stringify(body)).join('|\n');
    const fakeEda = {
      sys_FileManager: { async getDocumentSource() { await Promise.resolve(); return source(); } },
      dmt_SelectControl: { async getCurrentDocumentInfo() { return { uuid: 'ui-test-sheet', documentType: 1, tabId: 'ui-test-sheet@test' }; } },
      sch_PrimitiveComponent: { async getAllPinsByPrimitiveId(id) {
        assert(id === 'component-R1', 'Unexpected synthetic component ID');
        return [{ primitiveId: 'component-R1-pin1', x: 100, y: 100, pinNumber: '1', pinName: 'IN', noConnected: false }];
      } },
      sch_Event: {
        addPrimitiveEventListener(id, type, callback) { assert(type === 'all', 'Recorder should subscribe to all native events'); listeners.set(id, callback); },
        removeEventListener(id) { return listeners.delete(id); },
        isEventListenerAlreadyExist(id) { return listeners.has(id); }
      }
    };
    // Assign after load and before any control action. A fake API is the only
    // API available to the test recorder; Hybrid lint is independently stubbed.
    Object.defineProperty(w, 'eda', { value: fakeEda, configurable: true, writable: true });
    w.URL.createObjectURL = blob => {
      exports.push(blob.text().then(text => JSON.parse(text)));
      return 'blob:ui-test-' + exports.length;
    };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
    const lintRows = [
      { index: 0, severity: 'info', rawText: '2026-09-21 12:00:00\n[信息] : 开始设计规则检查' },
      { index: 1, severity: 'warning', rawText: '2026-09-21 12:00:00\n[警告] : R1.1 未连接 <>&\n  原始缩进\t' },
      { index: 2, severity: 'warning', rawText: '2026-09-21 12:00:00\n[警告] : R1.1 未连接 <>&\n  原始缩进\t' },
      { index: 3, severity: 'info', isSummary: true, rawText: '2026-09-21 12:00:00\n[信息] : 完成设计规则检查' }
    ];
    assert(w.CircuitStudioLinter && w.CircuitStudioHybrid, 'Built runtime did not initialize');
    w.CircuitStudioLinter.runLint = async options => {
      lintCalls.push({ rerun: options.rerun, listenersAtCheck: listeners.size });
      await Promise.resolve();
      if (failLint) throw new Error('Synthetic DRC failure for UI test');
      if (options.progress) options.progress(lintRows.length, lintRows.length);
      w.__csLastLintDiag = { complete: true, source: 'synthetic-ui-test', rerun: true };
      return JSON.parse(JSON.stringify(lintRows));
    };
    const emitMove = () => { for (const callback of listeners.values()) callback('move', { primitiveIds: ['wire-line'] }); };
    const count = id => Number.parseInt($(id).textContent, 10) || 0;
    const exported = async id => {
      const index = exports.length;
      click(id);
      await waitFor(() => exports.length > index, 'Export did not create a Blob');
      return await exports[index];
    };
    const endpointSeen = (report, x, y) => report.events.some(event => event.after?.line?.some(line => line.endX === x && line.endY === y));
    const pinSeen = report => report.events.some(event =>
      [event.connections?.before, event.connections?.after].some(connection =>
        connection?.endpoints?.some(point => point.pins?.some(pin => pin.designator === 'R1' && pin.number === '1'))));

    assert($('brand-version').textContent === 'v1.2.21', 'Unexpected built version');
    d.querySelector('[data-mode="recorder"]').click();
    assert($('btn-rec-export').disabled, 'Recorder export must be disabled before a session');
    click('btn-rec-start');
    assert($('btn-rec-start').disabled && $('btn-hybrid-start').disabled, 'Starting must gate both recording modes');
    await waitFor(() => !$('btn-rec-stop').disabled, 'Recorder did not start');
    endpoint = { x: 110, y: -100 }; emitMove();
    await waitFor(() => count('rec-count') > 0, 'Native wire edit did not appear in Recorder');
    assert($('btn-hybrid-start').disabled, 'Hybrid must not start during standalone recording');
    endpoint = { x: 125, y: -80 }; // Last edit deliberately has no native notification.
    click('btn-rec-stop');
    assert($('btn-rec-export').disabled, 'Export must be gated during final capture');
    await waitFor(() => !$('btn-rec-start').disabled && $('btn-rec-stop').disabled, 'Recorder did not stop');
    const recording = await exported('btn-rec-export');
    assert(recording.kind === 'recorder' && recording.recording === false, 'Standalone export is not a stopped recording');
    assert(recording.captureCoverage.finalSnapshotComplete, 'Final standalone snapshot is incomplete');
    assert(endpointSeen(recording, 125, -80), 'Stop lost the final unnotified geometry edit');
    assert(pinSeen(recording), 'Wire connection export lost R1 pin 1 identity');
    assert(recording.rawEvents.some(event => event.eventType === 'move'), 'Native move evidence was omitted');
    assert(listeners.size === 0 && lintCalls.length === 0, 'Standalone stop leaked listener or invoked lint');
    passes.push('Standalone buttons record native wire edits, pin identity, and the final unnotified edit in Blob export');

    endpoint = { x: 100, y: -100 };
    d.querySelector('[data-mode="hybrid"]').click();
    click('btn-hybrid-start');
    await waitFor(() => !$('btn-hybrid-stop').disabled, 'Hybrid did not start');
    assert($('btn-rec-start').disabled && $('btn-hybrid-export').disabled, 'Hybrid recording button gates failed');
    $('hybrid-note-input').value = '连接 R1.1 后检查 <>&'; click('btn-hybrid-note');
    endpoint = { x: 115, y: -100 }; emitMove();
    await waitFor(() => count('hybrid-count') > 0, 'Hybrid did not render native wire edit');
    assert(lintCalls.length === 0, 'Hybrid ran lint while still recording');
    endpoint = { x: 135, y: -75 };
    click('btn-hybrid-stop');
    assert($('btn-hybrid-export').disabled && $('btn-rec-start').disabled, 'Finalization must gate export and other recorder');
    await waitFor(() => !$('btn-hybrid-export').disabled, 'Hybrid did not finalize');
    const report = await exported('btn-hybrid-export');
    assert(report.kind === 'hybrid' && report.status === 'complete', 'Hybrid did not export a complete report');
    assert(endpointSeen(report, 135, -75), 'Hybrid lost final geometry edit');
    assert(pinSeen(report), 'Hybrid lost connection identities');
    same(report.lint.issues, lintRows, 'Hybrid export changed DRC records or duplicate rows');
    same(report.lint.text, lintRows.map(row => row.rawText).join('\n'), 'Hybrid export changed raw DRC text');
    same(Array.from(d.querySelectorAll('.hybrid-final-result .lint-log-msg'), node => node.textContent), lintRows.map(row => row.rawText), 'Hybrid rendered DRC differs from export');
    assert(report.notes[0].text === '连接 R1.1 后检查 <>&', 'Hybrid note was not exported');
    assert(lintCalls.length === 1 && lintCalls[0].rerun === true && lintCalls[0].listenersAtCheck === 0, 'Hybrid did not stop before exactly one fresh lint');
    passes.push('Hybrid stops, captures final edit, runs fresh lint once, and exports/render exact ordered DRC text including duplicates');

    endpoint = { x: 100, y: -100 }; failLint = true;
    click('btn-hybrid-start');
    await waitFor(() => !$('btn-hybrid-stop').disabled, 'Second Hybrid session did not start');
    assert(count('hybrid-count') === 0 && $('btn-hybrid-export').disabled, 'New Hybrid session retained an old report');
    endpoint = { x: 140, y: -100 }; emitMove();
    await waitFor(() => count('hybrid-count') > 0, 'Failure-case edit was not captured');
    click('btn-hybrid-stop');
    await waitFor(() => !$('btn-hybrid-export').disabled, 'Failed DRC did not preserve export');
    assert($('btn-hybrid-stop').textContent.includes('Retry'), 'Failed DRC did not offer retry');
    const failed = await exported('btn-hybrid-export');
    assert(failed.lint.status === 'failed' && failed.events.length > 0, 'Failed report discarded recording');
    assert(failed.sessionId !== report.sessionId && !endpointSeen(failed, 135, -75), 'New recording contains prior session events');
    failLint = false;
    click('btn-hybrid-stop');
    assert($('btn-hybrid-export').disabled, 'Retry did not gate incomplete export');
    await waitFor(() => !$('btn-hybrid-export').disabled, 'Retry did not finalize');
    const retried = await exported('btn-hybrid-export');
    assert(retried.status === 'complete' && retried.sessionId === failed.sessionId, 'Retry replaced the recording session');
    same(retried.events, failed.events, 'Retry changed retained recording evidence');
    assert(lintCalls.length === 3 && lintCalls.every(call => call.rerun === true), 'Retry did not run a new DRC');
    passes.push('DRC failure keeps recording exportable; retry succeeds without losing or duplicating its events');

    click('btn-hybrid-start');
    await waitFor(() => !$('btn-hybrid-stop').disabled, 'Clean session did not start');
    assert(count('hybrid-count') === 0 && count('hybrid-note-count') === 0, 'Clean session retained old event/note counts');
    click('btn-hybrid-stop');
    await waitFor(() => !$('btn-hybrid-export').disabled, 'Clean session did not finalize');
    const clean = await exported('btn-hybrid-export');
    assert(clean.sessionId !== retried.sessionId, 'New session reused old ID');
    same(clean.events, [], 'New unchanged session has old/spurious operations');
    same(clean.rawEvents, [], 'New unchanged session has old native events');
    same(clean.notes, [], 'New unchanged session has old notes');
    assert(listeners.size === 0, 'Final session left native listeners registered');
    assert(lintCalls.length === 4 && downloads.length === exports.length, 'Unexpected checks or download interception failure');
    passes.push('Starting a new session clears prior operations, native events, notes, and export state');
    return { passed: passes, exports: exports.length, lintCalls, finalListeners: listeners.size, actualCircuitApiCalls: 0 };
  } catch (error) {
    return { error: String(error?.message || error), stack: String(error?.stack || ''), passed: passes };
  } finally {
    try { browserWindow?.dispatchEvent(new browserWindow.Event('pagehide')); } catch (_) {}
    frame.remove();
  }
}

const response = await fetch(bridge + '/execute', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ windowId: windows.activeWindowId, code: `return await (${checkBuiltInterface.toString()})(${JSON.stringify(html)});` }),
  signal: AbortSignal.timeout(30000)
});
const result = await response.json();
assert.equal(response.ok && result.success, true, JSON.stringify(result));
assert.ok(!result.result.error, JSON.stringify(result.result, null, 2));
assert.equal(result.result.passed.length, 4);
assert.equal(result.result.actualCircuitApiCalls, 0);
assert.equal(result.result.finalListeners, 0);
for (const message of result.result.passed) console.log('PASS ' + message);
console.log(`${result.result.passed.length} built-iframe UI flows passed; ${result.result.exports} intercepted JSON exports; no circuit mutations.`);
