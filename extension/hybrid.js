// Shared by the iframe and extension entry: freeze recording, run fresh DRC,
// then export both results. A failed check never discards the recording.
async function finalizeHybrid(recorder, { notes = [], progress } = {}) {
  if (!recorder || !recorder.sessionId) throw new Error('Start a recording first.');
  if (progress) progress('stopping');
  let recordingError = null;
  try { await recorder.stop(); }
  catch (error) { recordingError = String(error && error.message || error); }
  const recording = JSON.parse(JSON.stringify(recorder.buildLog()));
  const report = {
    ...recording, kind: 'hybrid', schemaVersion: 2,
    notes: JSON.parse(JSON.stringify(notes)),
    lint: { status: 'running', startedAt: new Date().toISOString(), issues: [] }
  };
  async function verifyDocument() {
    if (!recording.document || !recording.document.uuid) return;
    const current = await eda.dmt_SelectControl.getCurrentDocumentInfo();
    if (!current || current.uuid !== recording.document.uuid) {
      throw new Error('The active schematic differs from the recorded document. Return to that schematic and retry DRC.');
    }
  }
  try {
    if (recordingError) throw new Error(recordingError);
    await verifyDocument();
    if (progress) progress('checking');
    const issues = JSON.parse(JSON.stringify(await globalThis.CircuitStudioLinter.runLint({
      rerun: true,
      progress: (copied, total) => { if (progress) progress('copying', copied, total); }
    })));
    await verifyDocument();
    report.lint = {
      ...report.lint, status: 'complete', finishedAt: new Date().toISOString(),
      issues, text: issues.map(row => row.rawText).join('\n'),
      diag: globalThis.__csLastLintDiag
    };
  } catch (error) {
    if (recordingError) report.recordingError = recordingError;
    report.lint = { ...report.lint, status: recordingError ? 'not-run' : 'failed', finishedAt: new Date().toISOString(),
      error: String(error && error.message || error), diag: globalThis.__csLastLintDiag };
  }
  report.status = recordingError ? 'recording-incomplete' : report.lint.status === 'complete' ? 'complete' : 'check-failed';
  report.lintSnapshots = [report.lint];
  report.timeline = [...report.events, ...report.notes,
    { kind: 'lint-snapshot', at: report.lint.finishedAt, ...report.lint }]
    .sort((a, b) => String(a.time || a.at).localeCompare(String(b.time || b.at)));
  return report;
}

globalThis.CircuitStudioHybrid = { finalizeHybrid };
