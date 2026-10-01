// Native events preserve rapid edits; source snapshots preserve all design fields,
// including wires whose getAll() is broken in some EasyEDA versions.
const RECORDER_POLL_MS = 800;

function recorderClone(value) {
  if (value === undefined) return null;
  const ancestors = [];
  return JSON.parse(JSON.stringify(value, function (_, v) {
    if (typeof v === 'bigint') return String(v);
    if (v && typeof v === 'object') {
      while (ancestors.length && ancestors[ancestors.length - 1] !== this) ancestors.pop();
      if (ancestors.includes(v)) return '[Circular]';
      ancestors.push(v);
    }
    return v;
  }));
}

function recorderStable(value) {
  if (Array.isArray(value)) return '[' + value.map(recorderStable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + recorderStable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

async function recorderTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' timeout')), 8000);
    })]);
  } finally { clearTimeout(timer); }
}

function recorderChanges(before, after, prefix = '', result = {}) {
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = before?.[key], b = after?.[key], path = prefix ? prefix + '.' + key : key;
    if (recorderStable(a) === recorderStable(b)) continue;
    if (a && b && !Array.isArray(a) && !Array.isArray(b) && typeof a === 'object' && typeof b === 'object') recorderChanges(a, b, path, result);
    else result[path] = { from: a === undefined ? null : a, to: b === undefined ? null : b, fromExists: a !== undefined, toExists: b !== undefined };
  }
  return result;
}

function recorderParseSource(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Cannot read the current schematic source. A complete recording snapshot is unavailable.');
  const records = [], keys = new Set();
  let document = null;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const separator = line.indexOf('||');
    if (separator < 0) throw new Error('Unsupported schematic source format (line ' + (index + 1) + ').');
    const header = JSON.parse(line.slice(0, separator));
    const body = JSON.parse(line.slice(separator + 2).replace(/\|\s*$/, ''));
    if (!header || typeof header.type !== 'string' || !body || typeof body !== 'object') throw new Error('The schematic source contains an invalid record.');
    // DOCHEAD updateTime/client/version change on every read without an edit.
    if (header.type === 'DOCHEAD') { document = body; continue; }
    const id = String(header.id ?? header.type);
    const key = header.type + ':' + id;
    if (keys.has(key)) throw new Error('The schematic source contains a duplicate record ID: ' + key);
    keys.add(key);
    records.push({ id, type: header.type, body });
  }
  if (!document || document.docType !== 'SCH_PAGE') throw new Error('Open a schematic page before starting a recording.');
  const documentId = document.uuid || document.id;
  if (!documentId) throw new Error('The schematic has no document ID. Recording sessions cannot be distinguished reliably.');
  return { document: { uuid: documentId, type: document.docType, name: document.name || document.title || '' }, records };
}

function recorderItems(records) {
  const byId = new Map(records.map(r => [r.id, r]));
  const grouped = new Map();
  for (const record of records) {
    let owner = record;
    const parent = record.type === 'ATTR' ? byId.get(record.body.parentId) : byId.get(record.body.lineGroup);
    if (parent && (record.type === 'ATTR' || ['WIRE', 'BUS'].includes(parent.type))) owner = parent;
    if (owner.type === 'LINE' && byId.has(owner.body.lineGroup)) owner = byId.get(owner.body.lineGroup);
    const key = owner.type + ':' + owner.id;
    if (!grouped.has(key)) grouped.set(key, { owner, records: [] });
    grouped.get(key).records.push(record);
  }
  const items = new Map();
  for (const [key, group] of grouped) {
    const { owner } = group, b = owner.body;
    const attributes = {};
    for (const r of group.records) if (r.type === 'ATTR') attributes[r.body.key || r.id] = r.body.value;
    group.records.sort((a, b) => (a.type + ':' + a.id).localeCompare(b.type + ':' + b.id));
    const type = owner.type.toLowerCase();
    const line = group.records.filter(r => r.type === 'LINE').map(r => ({ id: r.id, startX: r.body.startX, startY: r.body.startY, endX: r.body.endX, endY: r.body.endY }));
    items.set(key, {
      id: owner.id, primitiveType: owner.type, type,
      ref: attributes.Designator || attributes['Reference Designator'] || b.designator,
      name: attributes.Name || b.name,
      net: attributes['Global Net Name'] || attributes['Net Name'] || attributes.NET || attributes.Net || b.net,
      x: b.x, y: b.y, rotation: b.rotation, mirror: b.isMirror,
      attributes, line, records: group.records
    });
  }
  return items;
}

function recorderOnSegment(point, line) {
  const { x, y } = point, { startX: ax, startY: ay, endX: bx, endY: by } = line;
  if (![x, y, ax, ay, bx, by].every(Number.isFinite)) return false;
  const length = Math.hypot(bx - ax, by - ay);
  return Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) <= 1e-6 * Math.max(1, length)
    && x >= Math.min(ax, bx) - 1e-6 && x <= Math.max(ax, bx) + 1e-6
    && y >= Math.min(ay, by) - 1e-6 && y <= Math.max(ay, by) + 1e-6;
}

export class Recorder {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.events = []; this.rawEvents = [];
    this.sessionId = null; this.sessionStart = null; this.sessionEnd = null;
    this.recording = false; this.captureCoverage = null;
    this._queue = Promise.resolve(); this._documents = new Map();
    this._pendingNative = []; this._pins = new Map(); this._seq = 0;
    this._timer = null; this._listenerId = null; this._activeDocument = null;
  }

  async start() {
    if (this._starting) return this._starting;
    if (this.recording) return this.buildLog();
    this._starting = this._start();
    try { return await this._starting; } finally { this._starting = null; }
  }

  async _start() {
    if (typeof eda === 'undefined' || !eda.sys_FileManager?.getDocumentSource) throw new Error('This EasyEDA environment cannot read document source. Complete recording is unavailable.');
    this.events = []; this.rawEvents = []; this._pendingNative = [];
    this._documents.clear(); this._pins.clear(); this._seq = 0;
    this.sessionId = 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    this.sessionStart = new Date().toISOString(); this.sessionEnd = null;
    this._activeDocument = null; this._stopping = false;
    this.captureCoverage = {
      snapshotSource: 'sys_FileManager.getDocumentSource', nativeEvents: false,
      pinResolution: 'unavailable', finalSnapshotComplete: false,
      coordinateSystem: 'EasyEDA document source (API pin Y negated)', warnings: [],
      limitations: [
        'Records schematic design changes. Selection, zoom, and menu clicks that do not change the design are not design events.',
        'Native events provide only the event type and primitive IDs. Rapid edits may share a detailed snapshot; all received native events are retained.',
        'Pin and wire contacts are matched by source coordinates. Use native DRC and the netlist to verify electrical connectivity at crossings.'
      ]
    };
    this.recording = true;
    try {
      await this._subscribeNative();
      if (!this.captureCoverage.nativeEvents) {
        this.captureCoverage.limitations.push('This session uses snapshot polling only. Transient edits undone between snapshots may not be recoverable.');
      }
      await this.flush();
      this._timer = setInterval(() => this._requestCapture(), RECORDER_POLL_MS);
      return this.buildLog();
    } catch (error) { this.dispose(); throw error; }
  }

  async _subscribeNative() {
    this._listenerId = 'circuit-studio-recorder-' + this.sessionId;
    try {
      if (!eda.sch_Event?.addPrimitiveEventListener) throw new Error('The native primitive event API is unavailable');
      await eda.sch_Event.addPrimitiveEventListener(this._listenerId, 'all', (type, props) => this._native(type, props), false);
      this.captureCoverage.nativeEvents = true;
    } catch (error) {
      this._listenerId = null; this.captureCoverage.nativeEvents = false;
      this._warn('native-events', error);
    }
  }

  _native(type, props) {
    if (!this.recording) return;
    const event = {
      seq: this.rawEvents.length + 1, time: new Date().toISOString(), eventType: String(type),
      documentId: null, lastObservedDocumentId: this._activeDocument, props: recorderClone(props),
      primitiveIds: Array.isArray(props?.primitiveIds) ? props.primitiveIds.map(String) : []
    };
    this.rawEvents.push(event); this._pendingNative.push(event);
    if (!this._starting && !this._stopping) this._requestCapture();
  }

  _requestCapture() {
    if (!this.recording || this._captureRequested) return;
    this._captureRequested = this.flush().catch(error => this._warn('snapshot', error)).finally(() => { this._captureRequested = null; });
  }

  async flush() {
    if (!this.recording) return this.buildLog();
    const capture = this._queue.then(() => this._capture());
    this._queue = capture.catch(() => {});
    try { await capture; }
    catch (error) {
      this.captureCoverage.finalSnapshotComplete = false;
      this._warn('snapshot', error);
      throw error;
    }
    return this.buildLog();
  }

  async stop() {
    if (this._starting) await this._starting;
    if (this._stoppingPromise) return this._stoppingPromise;
    if (!this.recording) return this.buildLog();
    this._stoppingPromise = this._stop();
    try { return await this._stoppingPromise; } finally { this._stoppingPromise = null; }
  }

  async _stop() {
    this._stopping = true;
    clearInterval(this._timer); this._timer = null;
    try {
      await this.flush();
      if (this._listenerId) {
        try { await eda.sch_Event.removeEventListener(this._listenerId); }
        catch (error) { this._warn('unsubscribe', error); }
        this._listenerId = null;
      }
      await this.flush();
      this.recording = false;
      this.sessionEnd = new Date().toISOString();
      this.captureCoverage.finalSnapshotComplete = true;
      return this.buildLog();
    } catch (error) {
      this._warn('stop-snapshot', error);
      if (!this._listenerId && this.captureCoverage.nativeEvents) {
        this._warn('native-event-gap', new Error('Final capture failed while stopping. Transient edits between listener removal and re-registration may be missing.'));
        await this._subscribeNative();
      }
      // Preserve the session for retry; never silently export a stale final snapshot.
      this._timer = setInterval(() => this._requestCapture(), RECORDER_POLL_MS);
      throw error;
    } finally { this._stopping = false; }
  }

  async clear() {
    await this.stop();
    this.events = []; this.rawEvents = []; this._pendingNative = [];
    this._documents.clear(); this._pins.clear(); this._seq = 0;
    this.sessionId = null; this.sessionStart = null; this.sessionEnd = null;
    this.captureCoverage = null; this._activeDocument = null;
  }

  dispose() {
    clearInterval(this._timer); this._timer = null;
    if (this.recording) this._warn('disposed', new Error('The panel closed. The last unfinished snapshot may not have been recorded.'));
    this.recording = false;
    if (this._listenerId && typeof eda !== 'undefined') {
      try {
        const result = eda.sch_Event?.removeEventListener(this._listenerId);
        if (result?.catch) result.catch(error => this._warn('unsubscribe', error));
      } catch (error) { this._warn('unsubscribe', error); }
    }
    this._listenerId = null;
  }

  buildLog() {
    return recorderClone({
      schemaVersion: 2, sessionId: this.sessionId, sessionStart: this.sessionStart,
      sessionEnd: this.sessionEnd, exportedAt: new Date().toISOString(), recording: this.recording,
      document: this._documents.get(this._activeDocument)?.document || null,
      eventCount: this.events.length, events: this.events,
      rawEventCount: this.rawEvents.length, rawEvents: this.rawEvents, captureCoverage: this.captureCoverage,
      documents: [...this._documents.values()].map(d => ({
        document: d.document, initialCapturedAt: d.initialCapturedAt, finalCapturedAt: d.finalCapturedAt,
        initialSource: d.initialSource, finalSource: d.finalSource
      }))
    });
  }

  async _capture() {
    if (!this.recording) return;
    const pendingCount = this._pendingNative.length;
    const beforeInfo = eda.dmt_SelectControl?.getCurrentDocumentInfo
      ? await recorderTimeout(eda.dmt_SelectControl.getCurrentDocumentInfo(), 'Read current document') : null;
    const source = await recorderTimeout(eda.sys_FileManager.getDocumentSource(), 'Read schematic source');
    const parsed = recorderParseSource(source), documentId = parsed.document.uuid;
    if (beforeInfo?.uuid && beforeInfo.uuid !== documentId) throw new Error('The schematic changed during capture. The last complete snapshot was preserved; capture will retry.');
    const signature = recorderStable(parsed.records.slice().sort((a, b) => (a.type + ':' + a.id).localeCompare(b.type + ':' + b.id)));
    const previous = this._documents.get(documentId);
    let items = previous?.items;
    if (!previous || previous.signature !== signature) {
      items = recorderItems(parsed.records);
      await this._resolveConnections(items, documentId);
    }
    const afterInfo = eda.dmt_SelectControl?.getCurrentDocumentInfo
      ? await recorderTimeout(eda.dmt_SelectControl.getCurrentDocumentInfo(), 'Verify current document') : null;
    if (afterInfo?.uuid && afterInfo.uuid !== documentId) {
      this._pins.clear();
      throw new Error('The schematic changed while reading pins. The last complete snapshot was preserved; capture will retry.');
    }
    if (!this.recording) return;
    const pending = this._pendingNative.splice(0, pendingCount);
    const capturedAt = new Date().toISOString();
    if (this._activeDocument && this._activeDocument !== documentId) {
      this._push({ eventType: 'document.change', documentId, before: this._activeDocument, after: documentId, _desc: 'Switch schematic: ' + documentId });
    }
    this._activeDocument = documentId;
    const matched = new Set();
    if (previous && previous.signature !== signature) {
      for (const key of new Set([...previous.items.keys(), ...items.keys()])) {
        const before = previous.items.get(key), after = items.get(key);
        if (recorderStable(before) === recorderStable(after)) continue;
        const item = after || before;
        const recordIds = new Set([...(before?.records || []), ...(after?.records || [])].map(r => r.id));
        const native = pending.filter(e => (!e.lastObservedDocumentId || e.lastObservedDocumentId === documentId) && e.primitiveIds.some(id => recordIds.has(id)));
        native.forEach(e => matched.add(e.seq));
        const changes = before && after ? recorderChanges(before, after) : {};
        const action = !before ? 'add' : !after ? 'remove' :
          (before.x !== after.x || before.y !== after.y) ? 'move' :
          before.rotation !== after.rotation ? 'rotate' : before.mirror !== after.mirror ? 'mirror' : 'modify';
        const eventType = item.type === 'component' && ['add', 'remove', 'move'].includes(action) ? action : item.type + '.' + action;
        this._push({
          source: 'document-source', documentId, eventType,
          primitiveId: item.id, primitiveType: item.primitiveType, designator: item.ref,
          net: item.net, x: item.x, y: item.y, line: item.line,
          before: before || null, after: after || null, _changes: changes,
          connections: { before: before?.connections || null, after: after?.connections || null },
          nativeEventSeqs: native.map(e => e.seq), _desc: this._describe(action, before, after, changes)
        });
      }
    }
    for (const event of pending) {
      if (matched.has(event.seq)) continue;
      this._push({
        source: 'native-event', eventType: 'native.' + event.eventType, documentId: event.documentId,
        lastObservedDocumentId: event.lastObservedDocumentId,
        time: event.time, primitiveIds: event.primitiveIds, nativeEventSeqs: [event.seq],
        rawEvent: event, detailAvailable: false,
        _desc: 'Native ' + event.eventType + ': ' + (event.primitiveIds.join(', ') || 'No primitive IDs provided') + ' (intermediate state not captured; raw event retained)'
      });
    }
    this._documents.set(documentId, {
      document: parsed.document, signature, items,
      initialCapturedAt: previous?.initialCapturedAt || capturedAt, finalCapturedAt: capturedAt,
      initialSource: previous?.initialSource || source, finalSource: source
    });
    this.captureCoverage.lastSuccessfulCapture = capturedAt;
  }

  async _resolveConnections(items, documentId) {
    const pins = [];
    let failures = 0;
    const components = [...items.values()].filter(item => item.type === 'component');
    await Promise.all(components.map(async item => {
      const cacheKey = documentId + ':' + item.id, signature = recorderStable(item.records);
      let cached = this._pins.get(cacheKey);
      if (!cached || cached.signature !== signature) {
        try {
          if (!eda.sch_PrimitiveComponent?.getAllPinsByPrimitiveId) throw new Error('The pin API is unavailable');
          const all = await recorderTimeout(eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(item.id), 'Read component pins');
          if (!Array.isArray(all)) throw new Error('The pin API did not return a complete list');
          const read = (pin, name) => typeof pin['getState_' + name] === 'function' ? pin['getState_' + name]() : pin[name[0].toLowerCase() + name.slice(1)];
          cached = { signature, pins: all.map(pin => ({
            primitiveId: read(pin, 'PrimitiveId'), componentId: item.id, designator: item.ref,
            componentName: item.name, net: item.net, number: read(pin, 'PinNumber'), name: read(pin, 'PinName'),
            x: read(pin, 'X'), y: -read(pin, 'Y'), noConnected: read(pin, 'NoConnected')
          })) };
          this._pins.set(cacheKey, cached);
        } catch (error) { failures++; this._warn('pins', error); return; }
      }
      pins.push(...cached.pins); item.pins = cached.pins;
    }));
    this.captureCoverage.pinResolution = failures ? (failures === components.length ? 'unavailable' : 'partial') : 'available';
    pins.sort((a, b) => String(a.primitiveId).localeCompare(String(b.primitiveId)));
    const wires = [...items.values()].filter(item => ['wire', 'bus'].includes(item.type)).sort((a, b) => a.id.localeCompare(b.id));
    // Coordinate contacts scan segments against pins/other wires, O(S*(P+S)).
    // Very large sheets can replace this with a spatial index without changing evidence.
    for (const wire of wires) {
      const coordinates = new Map();
      for (const line of wire.line) {
        for (const [x, y] of [[line.startX, line.startY], [line.endX, line.endY]]) {
          if (Number.isFinite(x) && Number.isFinite(y)) coordinates.set(x + ',' + y, { x, y });
        }
      }
      wire.connections = {
        basis: 'coordinate-contact', pinResolution: this.captureCoverage.pinResolution,
        segmentContacts: pins.flatMap(pin => {
          const segmentIds = wire.line.filter(line => recorderOnSegment(pin, line)).map(line => line.id);
          return segmentIds.length ? [{ x: pin.x, y: pin.y, pin, segmentIds }] : [];
        }),
        endpoints: [...coordinates.values()].map(point => ({
          ...point,
          pins: pins.filter(pin => Math.abs(pin.x - point.x) < 1e-6 && Math.abs(pin.y - point.y) < 1e-6),
          wireIds: wires.filter(other => other.id !== wire.id && other.line.some(line => recorderOnSegment(point, line))).map(other => other.id)
        }))
      };
    }
  }

  _describe(action, before, after, changes) {
    const item = after || before;
    const verbs = { add: 'Add', remove: 'Remove', move: 'Move', rotate: 'Rotate', mirror: 'Mirror', modify: 'Modify' };
    const label = item.ref || item.name || item.id;
    const fields = Object.keys(changes).filter(k => !k.startsWith('records') && !k.startsWith('connections')).slice(0, 6);
    let detail = fields.length ? ' · ' + fields.join(', ') : '';
    if (['wire', 'bus'].includes(item.type)) {
      const render = value => (value?.connections?.endpoints || []).map(point => {
        const pins = point.pins.map(pin => (pin.designator || pin.componentName || pin.componentId) + '.' + (pin.number || pin.name || '?'));
        const targets = [...pins, ...point.wireIds.map(id => 'wire ' + id)];
        return '(' + point.x + ',' + point.y + ')' + (targets.length ? ' [' + targets.join(', ') + ']' : '');
      }).join(' ↔ ');
      detail = ' · ' + (before && after ? render(before) + ' → ' + render(after) : render(item));
      const contacts = item.connections?.segmentContacts || [];
      if (contacts.length) detail += ' · Pin contacts: ' + contacts.map(({ pin }) => (pin.designator || pin.componentName || pin.componentId) + '.' + (pin.number || pin.name || '?')).join(', ');
      if (item.net) detail += ' · net=' + item.net;
    } else if (action === 'move') detail = ' (' + before.x + ',' + before.y + ') → (' + after.x + ',' + after.y + ')' + detail;
    return (verbs[action] || action) + ' ' + item.primitiveType + ' ' + label + detail;
  }

  _push(event) {
    if (!this.recording) return;
    const entry = recorderClone({ seq: ++this._seq, time: new Date().toISOString(), scope: 'sch', ...event });
    this.events.push(entry);
    if (this.onEvent) {
      try { this.onEvent(entry); } catch (error) { this._warn('onEvent', error); }
    }
  }

  _warn(category, error) {
    const message = String(error?.message || error);
    if (!this.captureCoverage) return;
    if (this.captureCoverage.warnings.some(w => w.category === category && w.message === message)) return;
    this.captureCoverage.warnings.push({ category, message, time: new Date().toISOString() });
    console.warn('[CS-RECORDER]', category, message);
  }
}
