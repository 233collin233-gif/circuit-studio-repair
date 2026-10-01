import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const code = await fs.readFile(new URL('./recorder.js', import.meta.url), 'utf8');
const { Recorder } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
let records, documentId, callback, failSource, switchDuringPins, sourceReads = 0, concurrent = 0, maxConcurrent = 0;
const record = (type, id, body) => ({ type, id, body });
const component = () => records.find(r => r.id === 'c1');
const source = () => [
  JSON.stringify({ type: 'DOCHEAD' }) + '||' + JSON.stringify({ docType: 'SCH_PAGE', uuid: documentId, updateTime: ++sourceReads, version: String(sourceReads) }),
  ...records.map((r, i) => JSON.stringify({ type: r.type, id: r.id, ticket: i + sourceReads }) + '||' + JSON.stringify(r.body))
].join('|\n'); // Last record deliberately has no trailing pipe.
const api = () => ({
  sys_FileManager: { async getDocumentSource() {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    try {
      await new Promise(resolve => setTimeout(resolve, 3));
      if (failSource) throw new Error('simulated source failure');
      return source();
    } finally { concurrent--; }
  } },
  sch_Event: {
    addPrimitiveEventListener(id, type, cb) { assert.equal(type, 'all'); callback = cb; },
    removeEventListener() { callback = null; return true; }
  },
  dmt_SelectControl: { async getCurrentDocumentInfo() { return { uuid: documentId, documentType: 1 }; } },
  sch_PrimitiveComponent: { async getAllPinsByPrimitiveId(id) {
    assert.equal(id, 'c1');
    if (switchDuringPins) { documentId = 'page-b'; switchDuringPins = false; }
    return [{ primitiveId: 'c1-pin1', x: component().body.x, y: -component().body.y, pinNumber: '1', pinName: 'A', noConnected: false }];
  } }
});
function reset() {
  documentId = 'page-a'; failSource = false; switchDuringPins = false;
  records = [
    record('CANVAS', 'canvas', { originX: 0, originY: 0 }),
    record('COMPONENT', 'c1', { x: 10, y: -20, rotation: 0, isMirror: false, locked: false }),
    record('ATTR', 'a1', { parentId: 'c1', key: 'Designator', value: 'R1' }),
    record('ATTR', 'a2', { parentId: 'c1', key: 'Value', value: '10k' }),
    record('WIRE', 'w1', { zIndex: 1 }),
    record('LINE', 'l1', { lineGroup: 'w1', startX: 0, startY: -20, endX: 10, endY: -20 }),
    record('ATTR', 'n1', { parentId: 'w1', key: 'NET', value: 'SIG' }),
    record('BUS', 'bus1', { zIndex: 2 }),
    record('LINE', 'bl1', { lineGroup: 'bus1', startX: 10, startY: -10, endX: 30, endY: -10 }),
    record('FUTURE_PRIMITIVE', 'future1', { custom: { parameter: 'before' } })
  ];
  globalThis.eda = api();
}
let passed = 0;
async function check(name, run) {
  reset();
  const recorder = new Recorder();
  try { await run(recorder); console.log('PASS ' + name); passed++; }
  finally { recorder.dispose(); }
}

await check('baseline / volatile source metadata / coordinate pin and net evidence', async r => {
  await r.start(); await r.flush();
  assert.equal(r.events.length, 0);
  assert.equal(r.captureCoverage.nativeEvents, true);
  const wire = r._documents.get('page-a').items.get('WIRE:w1');
  assert.equal(wire.net, 'SIG');
  assert.equal(wire.connections.endpoints[1].pins[0].designator, 'R1');
  assert.equal(wire.connections.endpoints[1].pins[0].y, -20);
  await r.stop(); assert.equal(r.buildLog().captureCoverage.finalSnapshotComplete, true);
});

await check('same-ID move plus property change preserves both', async r => {
  await r.start();
  component().body.x = 15;
  records.find(i => i.id === 'a2').body.value = '20k';
  callback('move', { primitiveIds: ['c1'] }); await r.flush();
  const event = r.events.find(e => e.eventType === 'move');
  assert.equal(event.before.x, 10); assert.equal(event.after.x, 15);
  assert.deepEqual(event._changes['attributes.Value'].from, '10k');
  assert.equal(event._changes['attributes.Value'].to, '20k');
  assert.equal(event.nativeEventSeqs.length, 1);
  const wireEvent = r.events.find(e => e.primitiveId === 'w1');
  assert.equal(wireEvent.connections.before.endpoints[1].pins.length, 1);
  assert.equal(wireEvent.connections.after.endpoints[1].pins.length, 0);
  await r.stop();
});

await check('same-ID rotate, mirror, unknown property and value edits', async r => {
  await r.start();
  component().body.rotation = 90; await r.flush();
  component().body.isMirror = true; await r.flush();
  component().body.locked = true; await r.flush();
  records.find(i => i.id === 'future1').body.custom.parameter = 'after'; await r.flush();
  assert.ok(r.events.some(e => e.eventType === 'component.rotate'));
  assert.ok(r.events.some(e => e.eventType === 'component.mirror'));
  assert.ok(r.events.some(e => e.eventType === 'component.modify' && e.after.records.some(i => i.body.locked)));
  assert.ok(r.events.some(e => e.primitiveId === 'future1' && e.after.records[0].body.custom.parameter === 'after'));
  await r.stop();
});

await check('wire/bus same-ID endpoint and net edits, no wire API used', async r => {
  await r.start();
  records.find(i => i.id === 'l1').body.endX = 30;
  records.find(i => i.id === 'n1').body.value = 'CLOCK';
  records.find(i => i.id === 'bl1').body.endX = 40;
  await r.flush();
  const event = r.events.find(e => e.eventType === 'wire.modify');
  assert.equal(event.before.net, 'SIG'); assert.equal(event.after.net, 'CLOCK');
  assert.equal(event.after.line[0].endX, 30);
  assert.equal(event.connections.before.endpoints[1].pins[0].number, '1');
  assert.ok(r.events.some(e => e.eventType === 'bus.modify'));
  await r.stop();
});

await check('wire interior pin contact and endpoint-to-wire targets are retained', async r => {
  await r.start();
  records.find(i => i.id === 'l1').body.endX = 20;
  records.push(record('WIRE', 'w2', {}), record('LINE', 'l2', { lineGroup: 'w2', startX: 20, startY: -30, endX: 20, endY: 0 }));
  await r.flush();
  const event = r.events.find(e => e.primitiveId === 'w1');
  assert.equal(event.connections.after.endpoints[1].pins.length, 0);
  assert.equal(event.connections.after.segmentContacts[0].pin.designator, 'R1');
  assert.deepEqual(event.connections.after.endpoints[1].wireIds, ['w2']);
  assert.ok(event._desc.includes('wire w2'));
  await r.stop();
});

await check('rapid create/delete and undo native events survive unchanged source', async r => {
  await r.start();
  callback('create', { primitiveIds: ['transient1'] });
  callback('delete', { primitiveIds: ['transient1'] });
  await r.flush();
  assert.deepEqual(r.rawEvents.map(e => e.eventType), ['create', 'delete']);
  assert.deepEqual(r.events.map(e => e.eventType), ['native.create', 'native.delete']);
  assert.equal(r.buildLog().events[0].rawEvent.props.primitiveIds[0], 'transient1');
  await r.stop();
});

await check('immediate Stop flushes final unpolled edit and serialized queue', async r => {
  await r.start();
  records.push(record('TEXT', 'text1', { text: 'final edit' }));
  await Promise.all([r.flush(), r.flush(), r.stop()]);
  assert.equal(r.events.filter(e => e.primitiveId === 'text1').length, 1);
  assert.equal(maxConcurrent, 1);
  assert.equal(r.recording, false); assert.equal(callback, null);
  assert.ok(r.buildLog().documents[0].finalSource.includes('final edit'));
});

await check('source failure preserves snapshot, records coverage and permits Stop retry', async r => {
  await r.start();
  failSource = true;
  await assert.rejects(r.stop(), /simulated source failure/);
  assert.equal(r.events.length, 0);
  assert.equal(r._documents.get('page-a').items.size, 5);
  assert.equal(r.captureCoverage.finalSnapshotComplete, false);
  assert.equal(r.recording, true);
  assert.ok(r.captureCoverage.warnings.some(w => w.category === 'stop-snapshot'));
  failSource = false;
  records = records.filter(i => i.id !== 'future1');
  await r.stop(); assert.ok(r.events.some(e => e.eventType === 'future_primitive.remove'));
});

await check('failed post-unsubscribe snapshot restores listener with gap warning', async r => {
  await r.start();
  const remove = eda.sch_Event.removeEventListener;
  eda.sch_Event.removeEventListener = () => { const result = remove(); failSource = true; return result; };
  await assert.rejects(r.stop(), /simulated source failure/);
  assert.equal(typeof callback, 'function');
  assert.equal(r.captureCoverage.nativeEvents, true);
  assert.ok(r.captureCoverage.warnings.some(w => w.category === 'native-event-gap'));
  failSource = false; eda.sch_Event.removeEventListener = remove;
  callback('move', { primitiveIds: ['c1'] });
  await r.stop(); assert.equal(r.rawEvents.length, 1);
});

await check('switch pages segments source and prevents whole-sheet false deletes', async r => {
  await r.start();
  documentId = 'page-b'; records = [record('TEXT', 'text-b', { text: 'other page' })];
  await r.flush();
  assert.deepEqual(r.events.map(e => e.eventType), ['document.change']);
  assert.equal(r.buildLog().documents.length, 2);
  assert.equal(r.buildLog().document.uuid, 'page-b');
  await r.stop();
});

await check('mid-capture page switch rejects mixed pin metadata', async r => {
  await r.start();
  component().body.x = 17; switchDuringPins = true;
  await assert.rejects(r.flush(), /schematic changed/);
  assert.equal(r.events.length, 0);
  assert.equal(r._documents.get('page-a').items.get('COMPONENT:c1').x, 10);
  documentId = 'page-a'; await r.stop();
  assert.ok(r.events.some(e => e.eventType === 'move'));
});

await check('native API unavailable is explicitly marked; source recording remains useful', async r => {
  delete eda.sch_Event;
  await r.start(); assert.equal(r.captureCoverage.nativeEvents, false);
  assert.ok(r.captureCoverage.limitations.some(s => s.includes('Transient edits')));
  records.push(record('JUNCTION', 'j1', { x: 10, y: -20 }));
  await r.stop(); assert.ok(r.events.some(e => e.eventType === 'junction.add'));
});

await check('clear awaits capture; frozen exports do not mutate and repeated references survive', async r => {
  await r.start();
  records.find(i => i.id === 'l1').body.startX = -10;
  await r.stop();
  const log = r.buildLog();
  const event = log.events.find(e => e.primitiveId === 'w1');
  assert.equal(typeof event.before.connections.endpoints[1].pins[0], 'object');
  assert.equal(typeof event.after.connections.endpoints[1].pins[0], 'object');
  assert.equal(typeof event.connections.after.endpoints[1].pins[0], 'object');
  await r.clear(); assert.equal(r.events.length, 0); assert.equal(r.sessionId, null);
  assert.ok(log.events.length > 0); assert.equal(r._documents.size, 0);
});

console.log(`Recorder regression checks: ${passed} passed.`);
