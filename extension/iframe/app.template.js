// iframe/app.template.js — Circuit Studio panel
// Run lint, recording and export in the iframe using its eda API access.
// The main thread loads the panel; postMessage only selects its initial tab.
//
// Wire protocol:
//   iframe -> main: { type: 'cs.ready' }                  (once, on load)
//   main   -> iframe: { type: 'cs.mode', payload: { mode } } (sets default tab)

(function () {
	'use strict';

	// ============== Console error sink ==============
	// Use a shared prefix and JSON payload for DevTools error filtering.
	function reportError(category, err, extra) {
		try {
			const payload = Object.assign({
				ts: new Date().toISOString(),
				category: 'panel.' + category,
				message: String(err && err.message ? err.message : err),
				stack: err && err.stack ? String(err.stack).split('\n').slice(0, 5).join('\n  ') : null
			}, extra || {});
			console.error('[CS-ERR]', JSON.stringify(payload));
		} catch (_) {
			console.error('[CS-ERR] panel.' + category, err);
		}
	}

	// Surface global errors to the same channel
	try {
		window.addEventListener('error', (ev) => {
			reportError('global', ev.error || new Error(ev.message || 'unknown'), {
				source: ev.filename, line: ev.lineno, col: ev.colno
			});
		});
		window.addEventListener('unhandledrejection', (ev) => {
			reportError('global', ev.reason || new Error('unhandled rejection'));
		});
	} catch (_) {}

	// ============== State ==============
	let currentMode = 'lint';
	let lintRunning = false;
	let lintResult = null;
	let recorderRunning = false;
	let recorderEvents = [];
	let userNotes = [];
	let hybridRunning = false;
	let hybridEvents = [];
	let recorderBusy = false;
	let hybridPhase = 'idle';
	let hybridReport = null;

	// ============== DOM ==============
	const $ = (id) => document.getElementById(id);
	const modeTabs = $('mode-tabs').querySelectorAll('.mode-tab');
	const panels = { lint: $('panel-lint'), recorder: $('panel-recorder'), hybrid: $('panel-hybrid') };
	const statusMode = $('status-mode');
	const statusProgress = $('status-progress');
	const statusLabel = $('status-label');
	const connStatus = $('conn-status');
	const brandVersion = $('brand-version');

	const lintList = $('lint-list');
	const btnLintRun = $('btn-lint-run');
	const btnLintExport = $('btn-lint-export');
	const sumErr = $('sum-error');
	const sumWarn = $('sum-warn');
	const sumInfo = $('sum-info');
	const sumPass = $('sum-pass');

	const btnRecStart = $('btn-rec-start');
	const btnRecStop = $('btn-rec-stop');
	const btnRecClear = $('btn-rec-clear');
	const btnRecExport = $('btn-rec-export');
	const recDot = $('rec-dot');
	const recLabel = $('rec-label');
	const recSub = $('rec-sub');
	const recCount = $('rec-count');
	const timelineList = $('timeline-list');
	const noteInput = $('note-input');
	const btnAddNote = $('btn-add-note');

	const btnHybridStart = $('btn-hybrid-start');
	const btnHybridStop = $('btn-hybrid-stop');
	const btnHybridClear = $('btn-hybrid-clear');
	const btnHybridExport = $('btn-hybrid-export');
	const hybridTimeline = $('hybrid-timeline');
	const hybridNoteInput = $('hybrid-note-input');
	const btnHybridNote = $('btn-hybrid-note');
	const hybridCount = $('hybrid-count');
	const hybridRecState = $('hybrid-rec-state');
	const hybridErrCount = $('hybrid-err-count');
	const hybridWarnCount = $('hybrid-warn-count');
	const hybridNoteCount = $('hybrid-note-count');

	// ============== Recorder instances (live inside the iframe) ==============
	let recorder = null;
	let hybridRecorder = null;

	function ensureRecorder(onEvent) {
		if (recorder) return recorder;
		recorder = new Recorder(onEvent);
		return recorder;
	}
	function ensureHybridRecorder(onEvent) {
		if (hybridRecorder) return hybridRecorder;
		hybridRecorder = new Recorder(onEvent);
		return hybridRecorder;
	}
	function updateRecordingButtons() {
		const hybridBusy = hybridPhase === 'starting' || hybridPhase === 'finalizing';
		const hybridActive = hybridRunning || !!(hybridRecorder && hybridRecorder.recording);
		btnRecStart.disabled = recorderBusy || recorderRunning || hybridActive || hybridBusy;
		btnRecStop.disabled = recorderBusy || !recorderRunning;
		btnRecClear.disabled = recorderBusy || recorderRunning || !(recorder && recorder.sessionId);
		btnRecExport.disabled = recorderBusy || !(recorder && recorder.sessionId);
		btnHybridStart.disabled = hybridBusy || hybridActive || recorderRunning || recorderBusy;
		btnHybridStop.disabled = hybridBusy || !(hybridRunning || hybridPhase === 'failed');
		btnHybridClear.disabled = hybridBusy || hybridRunning || !(hybridRecorder && hybridRecorder.sessionId);
		btnHybridExport.disabled = hybridBusy || hybridRunning || !hybridReport;
		btnHybridStop.textContent = hybridPhase === 'failed' ? '↻ Retry DRC' : '■ Stop and check';
		btnLintRun.disabled = lintRunning || hybridBusy;
		btnAddNote.disabled = recorderBusy || !(recorder && recorder.sessionId);
		btnHybridNote.disabled = !hybridRunning;
	}
	function showCoverage(id, instance) {
		const el = $(id), coverage = instance && instance.captureCoverage;
		if (!el || !coverage) return;
		const native = coverage.nativeEvents ? 'Native edit events: enabled' : 'Snapshot polling only: transient edits may be missed';
		const pins = ({ available: 'available', partial: 'partially available', unavailable: 'unavailable' })[coverage.pinResolution] || 'preparing';
		el.textContent = native + ' · Pin contact detection: ' + pins;
		el.title = (coverage.limitations || []).join('\n');
	}

	function eventHtml(event, index) {
		const desc = event.kind === 'note' ? '📝 ' + event.text : event._desc || event.eventType || '';
		const detail = event.kind === 'note' ? '' : '<details class="event-detail"><summary>View change details</summary><pre>'
			+ esc(JSON.stringify(event, null, 2)) + '</pre></details>';
		return `<div class="tl-item"><div class="tl-seq">#${index + 1}</div>`
			+ `<div class="tl-desc">${esc(desc)}${detail}</div>`
			+ `<div class="tl-time">${esc((event.time || event.at || '').slice(11, 19))}</div></div>`;
	}

	window.addEventListener('pagehide', () => {
		for (const instance of [recorder, hybridRecorder]) {
			if (instance && instance.dispose) instance.dispose();
		}
	});

	// ============== Mode switching ==============
	modeTabs.forEach(tab => {
		tab.addEventListener('click', () => {
			const mode = tab.dataset.mode;
			setMode(mode);
		});
	});
	function setMode(mode) {
		currentMode = mode;
		modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
		Object.values(panels).forEach(p => p.classList.toggle('active', p.id === 'panel-' + mode));
		statusMode.textContent = mode === 'lint' ? 'Lint' : mode === 'recorder' ? 'Recorder' : 'Hybrid';
	}
	setMode(currentMode);

	// ============== Lint ==============
	btnLintRun.addEventListener('click', async () => {
		if (lintRunning) return;
		lintRunning = true;
		btnLintRun.disabled = true;
		lintResult = null;
		btnLintExport.disabled = true;
		btnLintRun.textContent = '⏳ Copying DRC…';
		statusLabel.textContent = 'Reading the bottom DRC panel';
		statusProgress.style.width = '5%';
		lintList.innerHTML = '<div class="empty-state"><div class="ico">⏳</div>Copying existing DRC results…</div>';
		try {
			const issues = await runLint({ progress: (copied, total) => {
				statusLabel.textContent = `Copying DRC: ${copied}/${total} rows`;
			} });
			lintResult = { issues, diag: globalThis.__csLastLintDiag };
			renderLintResult(lintResult);
			statusLabel.textContent = `Complete DRC log copied · ${issues.length} rows`;
		} catch (err) {
			reportError('lint', err);
			lintList.innerHTML = `<div class="empty-state error"><div class="ico">❌</div>Lint failed: ${esc(String(err && err.message ? err.message : err))}</div>`;
			statusLabel.textContent = 'Lint failed';
		}
		lintRunning = false;
		updateRecordingButtons();
		btnLintRun.textContent = '▶ Copy DRC';
		btnLintExport.disabled = !(lintResult && lintResult.issues);

	});

	btnLintExport.addEventListener('click', () => {
		if (!lintResult) return;
		downloadJson({ kind: 'lint', at: new Date().toISOString(), ...lintResult,
			text: lintResult.issues.map(row => row.rawText).join('\n') }, `circuit-studio-lint-${Date.now()}.json`);
	});

	function renderLintResult(payload) {
		const issues = (payload && payload.issues) || [];
		let fatalCount = 0, errCount = 0, warnCount = 0, infoCount = 0;
		for (const i of issues) {
			const s = i.severity || 'info';
			if (s === 'fatal')   fatalCount++;
			else if (s === 'error')  errCount++;
			else if (s === 'warning') warnCount++;
			else infoCount++;
		}
		sumErr.textContent  = fatalCount + errCount;
		sumWarn.textContent = warnCount;
		sumInfo.textContent = infoCount;
		sumPass.textContent = 0; // DRC has no per-rule pass count; hide it.

		if (!issues.length) {
			lintList.innerHTML = '<div class="empty-state">The DRC panel is empty. Run DRC in the bottom panel first.</div>';
			return;
		}
		// Render the captured text verbatim, with HTML escaping only.
		// Original timestamps, newlines, duplicate entries and summaries survive.
		lintList.innerHTML = '<div class="lint-source-banner">Original DRC log · ' + issues.length + ' rows</div>'
			+ '<div class="lint-log">' + issues.map(issue =>
				`<div class="lint-log-row" data-sev="${esc(issue.severity)}"><span class="lint-log-msg">${esc(issue.rawText)}</span></div>`
			).join('') + '</div>';
	}

	// ============== Recorder (standalone mode) ==============
	function setRecState(running) {
		recorderRunning = running;
		recDot.className = running ? 'rec-dot active' : 'rec-dot';
		recLabel.textContent = running ? 'Recording' : 'Stopped';
		recSub.textContent = running ? 'Recording schematic edits, wire endpoints, and contact changes' : 'Recording saved. View the change details or export the report.';
		updateRecordingButtons();
	}

	btnRecStart.addEventListener('click', async () => {
		if (recorderBusy || hybridRunning || (hybridRecorder && hybridRecorder.recording) || ['starting', 'finalizing'].includes(hybridPhase)) return;
		recorderBusy = true; updateRecordingButtons();
		try {
			ensureRecorder(() => renderTimeline());
			userNotes = [];
			await recorder.start();
			setRecState(true); renderTimeline();
		} catch (error) {
			reportError('recorder.start', error);
			recSub.textContent = error.message;
		} finally { recorderBusy = false; updateRecordingButtons(); }
	});
	btnRecStop.addEventListener('click', async () => {
		if (!recorder || recorderBusy) return;
		recorderBusy = true; updateRecordingButtons();
		try {
			await recorder.stop();
			setRecState(false); renderTimeline();
		} catch (error) {
			reportError('recorder.stop', error); recSub.textContent = error.message;
			recorderRunning = !!recorder.recording;
		} finally { recorderBusy = false; updateRecordingButtons(); }
	});
	btnRecClear.addEventListener('click', async () => {
		if (!recorder || recorderBusy || recorderRunning) return;
		recorderBusy = true; updateRecordingButtons();
		try {
			await recorder.clear(); userNotes = []; renderTimeline(); setRecState(false);
		} finally { recorderBusy = false; updateRecordingButtons(); }
	});
	btnRecExport.addEventListener('click', async () => {
		if (!recorder || recorderBusy) return;
		recorderBusy = true; updateRecordingButtons();
		try {
			await recorder.flush();
			downloadJson({ kind: 'recorder', ...recorder.buildLog(), notes: userNotes }, `circuit-studio-recorder-${Date.now()}.json`);
		} catch (error) {
			reportError('recorder.export', error); recSub.textContent = error.message;
		} finally { recorderBusy = false; updateRecordingButtons(); }
	});

	function addNote(text) {
		if (!text || !text.trim()) return;
		try {
			const seq = (recorder ? recorder.events.length : 0) + userNotes.length + 1;
			const entry = { seq, at: new Date().toISOString(), kind: 'note', text: text.trim() };
			userNotes.push(entry);
			renderTimeline();
		} catch (e) {
			reportError('recorder.addNote', e);
		}
	}
	btnAddNote.addEventListener('click', () => {
		addNote(noteInput.value);
		noteInput.value = '';
	});
	noteInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			addNote(noteInput.value);
			noteInput.value = '';
		}
	});

	function renderTimeline() {
		const events = recorder ? recorder.events : recorderEvents;
		const all = [...events, ...userNotes].sort((a, b) => String(a.time || a.at).localeCompare(String(b.time || b.at)));
		recCount.textContent = `${events.length} operations`;
		timelineList.innerHTML = all.map(eventHtml).join('');
		showCoverage('rec-coverage', recorder);
		updateRecordingButtons();
	}

	// ============== Hybrid: record, stop, fresh DRC, merged report ==============
	function setHybridState(phase) {
		hybridPhase = phase;
		hybridRunning = phase === 'recording';
		hybridRecState.textContent = ({ idle: 'Idle', starting: 'Preparing', recording: 'Recording',
			finalizing: 'Checking', complete: 'Report ready', failed: 'Retry needed' })[phase];
		hybridRecState.className = hybridRunning ? 'state active' : 'state';
		updateRecordingButtons();
	}
	btnHybridStart.addEventListener('click', async () => {
		if (recorderRunning || recorderBusy || (hybridRecorder && hybridRecorder.recording) || ['starting', 'recording', 'finalizing'].includes(hybridPhase)) return;
		setHybridState('starting');
		hybridReport = null; hybridEvents = []; renderHybrid();
		try {
			ensureHybridRecorder(event => { hybridEvents.push(event); renderHybrid(); });
			await hybridRecorder.start();
			setHybridState('recording');
			renderHybrid();
		} catch (error) {
			reportError('hybrid.start', error); statusLabel.textContent = error.message;
			setHybridState('idle');
		}
	});
	btnHybridStop.addEventListener('click', async () => {
		if (!hybridRecorder || !['recording', 'failed'].includes(hybridPhase)) return;
		setHybridState('finalizing');
		try {
			hybridReport = await globalThis.CircuitStudioHybrid.finalizeHybrid(hybridRecorder, {
				notes: hybridEvents.filter(event => event.kind === 'note'),
				progress: (phase, copied, total) => {
					statusLabel.textContent = phase === 'stopping' ? 'Saving final edits…'
						: phase === 'checking' ? 'Running a fresh EasyEDA DRC check…'
						: `Copying DRC: ${copied}/${total} rows`;
				}
			});
			setHybridState(hybridReport.status === 'complete' ? 'complete' : 'failed');
			statusLabel.textContent = hybridReport.status === 'complete'
				? `Combined report ready: ${hybridReport.events.length} operations + ${hybridReport.lint.issues.length} DRC rows`
				: hybridReport.lint.error;
			renderHybrid();
		} catch (error) {
			reportError('hybrid.stop', error); statusLabel.textContent = error.message;
			setHybridState('failed');
		}
	});
	btnHybridClear.addEventListener('click', async () => {
		if (!hybridRecorder || ['starting', 'recording', 'finalizing'].includes(hybridPhase)) return;
		setHybridState('starting');
		try {
			await hybridRecorder.clear(); hybridEvents = []; hybridReport = null;
			setHybridState('idle'); renderHybrid();
		} catch (error) { statusLabel.textContent = error.message; setHybridState('failed'); }
	});
	btnHybridExport.addEventListener('click', () => {
		if (!hybridReport || ['starting', 'recording', 'finalizing'].includes(hybridPhase)) return;
		downloadJson(hybridReport, `circuit-studio-hybrid-${Date.now()}.json`);
	});
	btnHybridNote.addEventListener('click', () => {
		addHybridNote(hybridNoteInput.value); hybridNoteInput.value = '';
	});
	hybridNoteInput.addEventListener('keydown', event => {
		if (event.key === 'Enter') { addHybridNote(hybridNoteInput.value); hybridNoteInput.value = ''; }
	});
	function addHybridNote(text) {
		if (!text || !text.trim() || !hybridRunning) return;
		hybridEvents.push({ at: new Date().toISOString(), kind: 'note', text: text.trim() });
		renderHybrid();
	}
	function renderHybrid() {
		const operations = hybridReport ? hybridReport.events : hybridRecorder ? hybridRecorder.events : hybridEvents.filter(event => event.kind !== 'note');
		const notes = hybridReport ? hybridReport.notes : hybridEvents.filter(event => event.kind === 'note');
		const lint = hybridReport && hybridReport.lint;
		const issues = lint && lint.status === 'complete' ? lint.issues : [];
		hybridCount.textContent = `${operations.length} operations`;
		hybridNoteCount.textContent = notes.length;
		hybridErrCount.textContent = issues.filter(row => row.severity === 'fatal' || row.severity === 'error').length;
		hybridWarnCount.textContent = issues.filter(row => row.severity === 'warning').length;
		const entries = [...operations, ...notes].sort((a, b) => String(a.time || a.at).localeCompare(String(b.time || b.at)));
		hybridTimeline.innerHTML = entries.map(eventHtml).join('');
		showCoverage('hybrid-coverage', hybridRecorder);
		if (lint) {
			const result = document.createElement('div'); result.className = 'hybrid-final-result';
			result.innerHTML = lint.status === 'complete'
				? '<div class="lint-source-banner">Fresh DRC log: ' + issues.length + ' rows</div>'
					+ issues.map(row => `<div class="lint-log-row"><span class="lint-log-msg">${esc(row.rawText)}</span></div>`).join('')
				: '<div class="empty-state error">DRC did not complete. The recording has been preserved.<br>' + esc(lint.error) + '</div>';
			hybridTimeline.appendChild(result);
		}
		updateRecordingButtons();
	}

	// ============== Export: browser Blob URL download ==============
	function downloadJson(obj, filename) {
		try {
			const json = JSON.stringify(obj, null, 2);
			const blob = new Blob([json], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			setTimeout(() => {
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			}, 100);
			statusLabel.textContent = 'Exported ' + filename;
		} catch (e) {
			reportError('export', e, { filename });
			console.log('[CS-EXPORT]', filename, obj);
			alert('Export failed: ' + String(e) + '\n\nFull JSON printed to console.');
		}
	}

	// ============== Helpers ==============
	function esc(s) {
		return String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);
	}

	// ============== Receive main.js messages ==============
	window.addEventListener('message', (ev) => {
		let msg;
		try { msg = JSON.parse(ev.data); } catch { return; }
		if (!msg || !msg.type) return;
		try {
			if (msg.type === 'cs.mode' && msg.payload && msg.payload.mode) {
				setMode(msg.payload.mode);
			} else if (msg.type === 'cs.lint.result' && msg.payload && msg.payload.issues) {
				lintResult = msg.payload;
				renderLintResult(lintResult);
				btnLintExport.disabled = false;
			} else if (msg.type === 'cs.lint.error' && msg.payload && msg.payload.message) {
				reportError('lint.fromMain', new Error(msg.payload.message));
				lintList.innerHTML = `<div class="empty-state error"><div class="ico">❌</div>Lint error from main: ${esc(msg.payload.message)}</div>`;
			} else if (msg.type === 'cs.recorder.event' && msg.payload && msg.payload.event) {
				if (currentMode === 'hybrid') { hybridEvents.push(msg.payload.event); renderHybrid(); }
				else { recorderEvents.push(msg.payload.event); renderTimeline(); }
			} else if (msg.type === 'cs.hybrid.result' && msg.payload) {
				hybridReport = msg.payload;
				setHybridState(hybridReport.status === 'complete' ? 'complete' : 'failed');
				renderHybrid();
			}
		} catch (e) {
			reportError('panel.handleMessage', e, { type: msg.type });
		}
	});

	// ============== Boot ==============
	updateRecordingButtons();
	brandVersion.textContent = 'v1.2.21';
	connStatus.textContent = 'Panel ready';

	try {
		const params = new URLSearchParams(window.location.search);
		const m = params.get('mode');
		if (m === 'lint' || m === 'recorder' || m === 'hybrid') setMode(m);
	} catch (_) {}

	try {
		console.log('[CS] panel ready, version=1.2.21, errors -> [CS-ERR]');
		if (typeof parent !== 'undefined' && parent && parent !== window) {
			parent.postMessage(JSON.stringify({ type: 'cs.ready' }), '*');
		}
	} catch (_) {}
})();
