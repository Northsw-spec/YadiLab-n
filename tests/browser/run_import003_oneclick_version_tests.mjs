import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (name) => fs.readFileSync(name, 'utf8');
const ui = read('ui/app/main.mjs');
const css = read('ui/app/app.css');
const packageInfo = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const builder = read('scripts/build_browser_app.mjs');
const launcher = read('start-yadilab.sh');
const checkpoint = packageInfo.yadilabRelease.checkpoint;
const version = packageInfo.version;

assert.equal(packageInfo.version, version);
assert.equal(lock.version, version);
assert.equal(lock.packages[''].version, version);
assert.ok(builder.includes('version: release.version') && builder.includes('checkpoint: release.checkpoint'));
assert.ok(launcher.includes("APP_VERSION=$(read_marker version)"));
assert.ok(launcher.includes("CHECKPOINT=$(read_marker checkpoint)"));
assert.ok(launcher.includes('YADILAB_PORT:-18236'), 'New default port avoids old service worker origin and stale launcher');
assert.ok(launcher.includes('"\\"checkpoint\\": \\"$CHECKPOINT\\""') || launcher.includes('"\\"checkpoint\\": \\"$CHECKPOINT\\""'));
assert.ok(ui.includes('"data-yadilab-build-version": releaseIdentity.version'));
assert.ok(ui.includes('"data-development-checkpoint": releaseIdentity.checkpoint'));

const from = ui.indexOf('function MainActions(');
const to = ui.indexOf('function ControlSection(', from);
assert.ok(from >= 0 && to > from);
const actions = ui.slice(from,to);
const visible = actions.indexOf('"data-network-import-primary": "true"');
const menus = actions.indexOf('className: "main-actions-menus"');
assert.ok(visible > -1 && visible < menus, 'Persistent import button MUST precede collapsible menus');
assert.equal(actions.match(/"data-network-import-primary": "true"/g)?.length,1);
assert.ok(actions.includes('Import JSON / Excel / CSV → Network Topology'));
assert.ok(actions.includes('onClick: openNetworkPicker'));
assert.ok(actions.includes('networkPickerRef.current?.click()'), 'A click MUST launch native file chooser synchronously');
assert.ok(actions.includes('data-network-import-quick-file'));
assert.ok(ui.includes('onImportNetworkFile: (file) =>'));
assert.ok(ui.includes('initialSelection: networkImportSelection'));
assert.ok(css.includes('.network-import-overlay { position: fixed;'), 'Review MUST be a visible foreground dialog');
assert.ok(ui.includes('id: "network-topology-import-panel"'));
assert.ok(ui.includes('data-network-import-file'));
assert.ok(ui.includes('Create topology in Builder (edit only)'));
assert.ok(css.includes('.main-actions-primary-import .network-import-primary-button'));
assert.ok(css.includes('min-height: 2.8rem'));

// Also exercise the real compiled production artifact, not source-only strings.
const marker = JSON.parse(read('ui/dist/build-marker.json'));
assert.equal(marker.version, version);
assert.equal(marker.marker, `yadilab-v${version}`);
assert.equal(marker.checkpoint, checkpoint);
const bundle = read('ui/dist/assets/app.js');
assert.ok(bundle.includes('Import JSON / Excel / CSV \\u2192 Network Topology') || bundle.includes('Import JSON / Excel / CSV → Network Topology'));
assert.ok(bundle.includes('data-network-import-primary'));
assert.ok(bundle.includes('data-network-import-file'));
assert.ok(bundle.includes('data-network-import-quick-file'));
assert.ok(bundle.includes('data-network-import-overlay'));
assert.ok(bundle.includes(version));
console.log('PASS IMPORT-004: persistent primary button ahead of collapsed menus, version alignment, unique port, compiled bundle and marker.');
