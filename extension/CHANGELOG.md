# Changelog

## 1.2.21 — 2026-09-28

- Complete English interface across Lint, Recorder, and Hybrid: controls, status messages, errors, event descriptions, capture limits, help text, and extension metadata.
- Preserve original DRC output, design names, component properties, and user notes verbatim. The panel explains that source data keeps its original language.
- Wrap long action rows and event details for readable English screenshots. Hide the unused per-rule pass counter, which the native log does not supply.
- Keep the existing report schema, passive Lint copy, final Recorder snapshot, and single fresh Hybrid check. No translation service or new runtime dependency.
- Retain the v1.2.20 package separately. Update the regression expectations for English messages while keeping multilingual source-data fixtures.

## 1.2.20 — 2026-09-28

- Fix stale virtual DRC rows in background or occluded editor windows by explicitly refreshing the list after scrolling and restoring its position.
- Yield through the parent document's MessageChannel to avoid background timer throttling during capture.
- Share the complete-copy fix between Lint and Hybrid; verify total count, continuous indexes, original text, and the completion row.
- Clarify that copying an existing DRC result does not start another check. Add a background-scrolling regression.

## 1.2.19

- Capture full schematic source differences, wire/bus geometry, coordinate contacts, native editing events, and the final snapshot on stop.
- Export before/after evidence and capture coverage. Preserve recordings when DRC fails and support retry.
- Hybrid finishes recording before requesting a fresh DRC and combines the complete log with the recording.

## 1.2.18

- Read the schematic DRC log container by indexed virtual rows. Preserve duplicate messages and source formatting.
- Require the captured total to match the native count, with continuous indexes and the original completion row. Reject incomplete captures.
- Restore filters and scroll position after reading. Share the reader between Lint and Hybrid and rebuild both bundled copies from the same source.

## 1.2.14 — 2026-09-21

- Retain log lines that do not match a severity-prefix pattern instead of silently dropping them.

## 1.2.13 — 2026-09-21

- Address off-screen virtual-list rows, duplicate messages, and long warnings in the earlier DRC reader.

## 1.2.12 — 2026-09-21

- Expand the earlier panel lookup and remove its early return on a partial match.

## 1.2.11 — 2026-09-21

- Recognize the native warning class and expand multiline log text before parsing.

## 1.2.10 — 2026-09-21

- Move Lint toward passive copying of the existing native DRC log, with clearer source attribution and export documentation.

## 1.2.5–1.2.9 — 2026-09-21

- Introduce panel-based DRC capture, run Hybrid DRC after recording stops, and remove unsupported primitive calls from the earlier checker.

## 1.0.0–1.1.x

- Earlier versions used a custom schematic-rule implementation. Native DRC capture replaced that design because the two rule sets could diverge.

Historical release files are retained separately. The behavior described under 1.2.21 and the current README takes precedence over older implementation notes.
