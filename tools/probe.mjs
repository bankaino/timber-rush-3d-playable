// probe.mjs — numbers instead of screenshots (run from the project root). Opens live/index.html?render=1 on a phone
// viewport, renders every SCENE.QA() state and prints ONE line per state: draw calls, triangles, the hero's height in % of
// the screen and whether it is fully on screen, HUD boxes off-screen / overlapping. Exit 1 on page errors or HUD faults.
//   node <S>/scripts/probe.mjs [--w 390 --h 844] [--shots frames/probe]     (--shots also saves one PNG per state)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const R2G = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'skills', 'ref2game', 'scripts');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT || path.join(R2G, 'node_modules', 'playwright'));
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const root = process.cwd(), shots = opt('shots', '');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.webp': 'image/webp' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'] });
const tab = await browser.newPage({ viewport: { width: +opt('w', 390), height: +opt('h', 844) }, deviceScaleFactor: 1 });
const errors = []; tab.on('pageerror', (e) => errors.push(e.message)); tab.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await tab.goto(`http://127.0.0.1:${srv.address().port}/live/index.html?render=1`);
let bad = 0;
try { await tab.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }); }
catch (e) { console.log('PROBE FAIL page did not boot: ' + (errors.join(' | ') || e.message)); await browser.close(); srv.close(); process.exit(1); }
const view = await tab.evaluate(() => SIM.VIEW); console.log(`probe view ${view.W}x${view.H}`);
if (shots) fs.mkdirSync(shots, { recursive: true });
for (const n of await tab.evaluate(() => window.__qaNames())) {
  const r = await tab.evaluate(([n, s]) => window.__probe(n, s), [n, !!shots]);
  const flags = [...(r.heroOn ? [] : ['HERO OFF-SCREEN']), ...(r.hudOut.length ? ['HUD OUT ' + r.hudOut.join(',')] : []), ...(r.hudOverlap.length ? ['HUD OVERLAP ' + r.hudOverlap.join(',')] : [])];
  if (r.hudOut.length || r.hudOverlap.length) bad++;
  console.log(`${n.padEnd(12)} draws ${String(r.calls).padStart(3)}  tris ${String(Math.round(r.tris / 1000)).padStart(4)}k  hero ${String(r.heroH).padStart(4)}%  ${flags.join('  ') || 'ok'}`);
  if (shots) fs.writeFileSync(path.join(shots, n + '.jpg'), Buffer.from(r.shot.split(',')[1], 'base64'));
}
if (errors.length) { console.log('PROBE FAIL page errors: ' + errors.slice(0, 3).join(' | ')); bad++; }
await browser.close(); srv.close(); process.exit(bad ? 1 : 0);
