# Circuit Studio v1.2.21 — English interface release validation

Date: 2026-09-28. Base release: v1.2.20. The base source folder and installable package were retained separately.

## Scope

Translated the extension's own interface, statuses, errors, Recorder descriptions and coverage limits, help, and metadata to English. The manifest, panel header, About dialog, activation message, and generated entry points all identify v1.2.21.

Original DRC rows, user-entered notes, schematic names, primitive properties, IDs, and native event data remain source evidence. They are neither translated nor paraphrased. Export field names and capture/check behavior remain compatible with v1.2.20. No network service or additional runtime dependency was added.

Action rows now wrap; event text and note inputs can shrink without forcing horizontal overflow. The unsupported per-rule pass placeholder is hidden. Three mode panels were inspected visually in EasyEDA using a clearly labelled isolated preview, without changing or saving a real design.

## Results

| Check | Result | Coverage |
| --- | --- | --- |
| Build | Passed | Bundled entry point and inline panel generated; installable v1.2.21 archive created. |
| DRC regression suite | 12 passed | Virtual rows, background rendering/timer throttling, duplicate rows, late appends, incomplete results, restoration of filters and scroll position, shared capture. |
| Recorder regression suite | 13 passed | Changes on existing IDs, endpoints, pin contacts, native events, final snapshot, source failures, page changes, session clearing, detached exports. |
| Hybrid regression suite | 14 passed | Stop-before-check, final edit, complete raw DRC and notes, failure retention, retry, freshness detection, background rendering, filter restoration. |
| Packaged interface workflows | 4 passed | Recorder export, Hybrid export, failed DRC and retry, clean subsequent session; 5 intercepted JSON exports. |
| English layout checks | 6 passed | Lint, Recorder, and Hybrid at 620 px and 1000 px widths; no control/body horizontal overflow and no Chinese interface text. |
| Source scan | Passed | No Han characters in shipped interface source, metadata, or English documentation. Multilingual regression fixtures are retained intentionally. |
| Visual review | Passed | All three empty-mode panels inspected; controls, headings, source-language notice, and note fields remain readable. |

The interface workflows used an isolated fake API inside the connected EasyEDA browser. Actual circuit API calls: **0**. Layout previews carried an explicit “isolated interface preview (no experiment data)” label and were removed after inspection. These checks are software validation, not participant or circuit-performance evidence.

## Limits and installation

This package was built and its packaged interface was tested. It was **not installed over the user's active extension** during this validation. Import the new `.eext`, close any older Circuit Studio panel, and reopen the panel to use v1.2.21.

The interface language does not change the editor language or historical DRC messages. To capture English native DRC text, run DRC using EasyEDA's English interface. Existing Chinese notes and design names remain unchanged. This release makes no new claim that Recorder captures every UI gesture or that a clean DRC guarantees a working physical circuit.

The installable archive checksum is recorded separately in `release-manifest.json` in the source folder, avoiding a self-referential archive checksum.

## Repository publication note — 2026-10-01

The original validation above is retained as a historical record. The publication copy of its manifest is [../releases/v1.2.21-manifest.json](../releases/v1.2.21-manifest.json), with a relative artifact path. The original validated archive is preserved in `../releases/`; rebuilt packages are written to `build/`.
