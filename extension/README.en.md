# Circuit Studio v1.2.21

Circuit Studio helps collect evidence for schematic refinement in EasyEDA. This release provides an English interface for **Lint**, **Recorder**, and **Hybrid**, including buttons, status messages, error messages, event descriptions, coverage hints, and extension metadata.

## Install

Download [`circuit-studio_v1.2.21.eext`](../releases/circuit-studio_v1.2.21.eext) and import it through the EasyEDA extension manager. The extension keeps its existing identifier, so it updates the installed Circuit Studio extension. Close any earlier Circuit Studio panel, then open **Circuit Studio → Circuit Studio Panel**. Check that the panel header shows **v1.2.21**.

This release retains the v1.2.20 report schema and capture/check sequence.

## Choose a mode

| Mode | Workflow | Export |
| --- | --- | --- |
| Lint | Run schematic DRC in EasyEDA, then select **Copy DRC**. Copying does not run another check. | Complete original DRC rows, timestamps, and combined text. |
| Recorder | Select **Start recording**, edit the schematic, optionally **Insert note**, then **Stop and save**. | Design changes, before/after snapshots, wire endpoints, coordinate contacts, received native events, and notes. |
| Hybrid | Select **Start recording**, edit and add notes, then **Stop and check**. | Recording plus one fresh, complete DRC log in a single JSON file. |

Use **Export JSON report**, **Export recording**, or **Export recording + DRC** to save the corresponding report. If Hybrid DRC fails, the recording stays available and **Retry DRC** requests another check. A failed check is never presented as a successful complete capture.

## English screenshots and original evidence

All extension-generated interface text is English. **DRC messages, project/document names, component text, and user notes are source data and retain their original language.** Captured DRC text is never translated or paraphrased.

For an entirely English screenshot, use EasyEDA's own English interface and run a new DRC in that language before selecting **Copy DRC**. Write new notes in English when appropriate. Circuit Studio does not alter existing Chinese logs or notes to make a screenshot look English, and does not change EasyEDA's language preference.

The action rows wrap when the panel is narrow. Maximize or widen the panel for long notes, DRC messages, or expanded before/after details. The obsolete “Rules passed” placeholder is hidden because the mirrored DRC log does not provide a per-rule pass count.

## Capture limits

Recorder supports schematic pages. It captures design changes rather than selection, zoom, or every menu gesture. Very rapid intermediate edits may share a snapshot; received native events are retained and capture limits are exported. Pin/wire coordinate contact is evidence to inspect, not a guarantee of electrical connectivity. Verify the native DRC and netlist as well.

The extension runs locally and adds no translation service or network dependency.

## Build and verify

From this `extension/` directory:

```shell
npm install
npm test
```

`npm test` builds the extension before running all three regression suites. Use `npm run build` to rebuild without running the tests.

The rebuilt installable package is written to `build/circuit-studio_v1.2.21.eext`; it does not overwrite the published package in `../releases/`. The published file is the original validated archive. Local rebuilds include the current documentation, so their archive checksum may differ.

With EasyEDA and its Bridge already connected, optional isolated UI checks are:

```shell
npm run test:ui
npm run test:layout
```

The build uses the pinned `esbuild` and `adm-zip` development dependencies. The regression cases use Node.js built-in assertions; the Lint suite also checks the generated bundle, so a build must run first. The optional UI checks require the connected EasyEDA Bridge and exercise the packaged interface in an isolated iframe with a fake EDA API. It does not modify a real schematic. Chinese test fixtures intentionally verify that original DRC rows and notes survive the English interface unchanged.

See `RELEASE-VALIDATION.md` for the checks and limitations of this release.
