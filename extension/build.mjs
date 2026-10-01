import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const AdmZip = require('adm-zip');
const read = name => readFileSync(join(root, name), 'utf8');
const out = join(root, 'build');
mkdirSync(join(out, 'dist'), { recursive: true });
mkdirSync(join(out, 'iframe'), { recursive: true });
await esbuild.build({ absWorkingDir: root, entryPoints: [join(root, 'main.js')], outfile: join(out, 'dist/index.js'),
  bundle: true, format: 'iife', globalName: 'edaEsbuildExportName', platform: 'browser', target: 'chrome90' });
const script = read('recorder.js').replace(/export class Recorder/g, 'class Recorder')
  + '\n' + read('linter.js') + '\n' + read('hybrid.js') + '\n' + read('iframe/app.template.js');
const html = read('iframe/index.html');
const tag = '<script src="app.js"></script>';
if (html.split(tag).length !== 2) throw new Error('Expected exactly one app.js script placeholder');
// A function replacer preserves literal $ sequences in generated JavaScript.
writeFileSync(join(out, 'iframe/index.html'), html.replace(tag, () => '<script>\n' + script + '\n</script>'));
const zip = new AdmZip();
for (const name of ['extension.json', 'README.md', 'README.en.md', 'CHANGELOG.md', 'RELEASE-VALIDATION.md', 'LICENSE', 'linter.js', 'recorder.js', 'hybrid.js']) {
  zip.addFile(name, readFileSync(join(root, name)));
}
for (const name of readdirSync(join(root, 'images'))) zip.addLocalFile(join(root, 'images', name), 'images');
zip.addLocalFile(join(out, 'dist/index.js'), 'dist');
zip.addLocalFile(join(out, 'iframe/index.html'), 'iframe');
// Keep the unpacked entry point current as well as the installable archive.
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.js'), readFileSync(join(out, 'dist/index.js')));
const version = JSON.parse(read('extension.json')).version;
const artifact = join(out, `circuit-studio_v${version}.eext`);
zip.writeZip(artifact);
console.log('Built ' + relative(process.cwd(), artifact));
