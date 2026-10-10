#!/usr/bin/env python3
"""build_playable.py - one command from the live 3D project to ad-network-ready single-file playables.

    python tools/build_playable.py [--variant default|all] [--networks all|applovin,unity,...] [--out dist] [--pages docs]

For every network it writes dist/<variant>/<network>.html (Google: a .zip with index.html) where everything is inline:
three.js (tree-shaken to what the game uses by the skill's three_slim.mjs; --full-three ships vendor/three.min.js), the game modules (minified with the skill's esbuild when available), HUD images as WebP
at the size the HUD draws them, GLB models as base64 (already meshopt-compressed by model.mjs), and the network's CTA /
lifecycle adapter. Checks each file against the network's size limit and forbidden external requests and writes
dist/<variant>/report.md with a size breakdown. Variants (A/B hypotheses) are JSON overrides of SIM.K in variants/.
Module order comes from the FILES line in live/index.html; images/models/title/store from tools/build.json.
"""
import argparse, base64, io, json, os, re, subprocess, sys, zipfile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIVE = os.path.join(ROOT, 'live')
SKILL = os.path.join(os.path.expanduser('~'), '.claude', 'skills', 'ref2playable3d')
CFG = json.load(open(os.path.join(ROOT, 'tools', 'build.json'), encoding='utf-8'))
STORE, TITLE = CFG['store'], CFG.get('title', 'Playable')

NETWORKS = {
    'applovin':   {'limit': 5_000_000, 'adapter': 'mraid', 'mraid_tag': True},
    'unity':      {'limit': 5_000_000, 'adapter': 'mraid', 'mraid_tag': True},
    'ironsource': {'limit': 5_000_000, 'adapter': 'dapi',  'mraid_tag': True},
    'mintegral':  {'limit': 5_000_000, 'adapter': 'mintegral', 'mraid_tag': False},
    'google':     {'limit': 5_000_000, 'adapter': 'exitapi', 'mraid_tag': False, 'zip': True},
    'meta':       {'limit': 2_000_000, 'adapter': 'meta', 'mraid_tag': False},
    'preview':    {'limit': 5_000_000, 'adapter': 'web', 'mraid_tag': False},
}
ALLOWED_EXTERNAL = {'mraid.js', 'https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js'}

ADAPTERS = {
    'mraid': """(function(){var M=window.mraid;var url=function(){return /iphone|ipad|ipod/i.test(navigator.userAgent)?STORE.ios:STORE.android;};
window.__openStore=function(){try{if(M&&M.open){M.open(url());return;}}catch(e){}window.open(url());};
function vis(v){if(window.AUDIO)AUDIO.mute(!v);}
function ready(){try{if(M.isViewable)vis(M.isViewable());M.addEventListener('viewableChange',vis);
M.addEventListener('audioVolumeChange',function(p){if(window.AUDIO)AUDIO.mute(p===0);});}catch(e){}}
if(M){if(M.getState&&M.getState()==='loading')M.addEventListener('ready',ready);else ready();}})();""",
    'dapi': """(function(){var D=window.dapi;var url=function(){return /iphone|ipad|ipod/i.test(navigator.userAgent)?STORE.ios:STORE.android;};
window.__openStore=function(){try{if(D&&D.openStoreUrl){D.openStoreUrl();return;}if(window.mraid&&mraid.open){mraid.open(url());return;}}catch(e){}window.open(url());};
function vis(v){if(window.AUDIO)AUDIO.mute(!(v&&v.isViewable!==undefined?v.isViewable:v));}
function ready(){try{D.addEventListener('viewableChange',vis);D.addEventListener('audioVolumeChange',function(v){if(window.AUDIO)AUDIO.mute(!v);});vis(D.isViewable());}catch(e){}}
if(D){if(D.isReady&&D.isReady())ready();else D.addEventListener('ready',ready);}})();""",
    'mintegral': """(function(){window.__openStore=function(){if(window.install)window.install();};
window.__onEnd=function(){if(window.gameEnd)window.gameEnd();};
window.addEventListener('load',function(){if(window.gameReady)window.gameReady();});
window.gameStart=function(){};window.gameClose=function(){if(window.AUDIO)AUDIO.mute(true);};})();""",
    'exitapi': """(function(){window.__openStore=function(){if(window.ExitApi)ExitApi.exit();};})();""",
    'meta': """(function(){window.__openStore=function(){if(window.FbPlayableAd)FbPlayableAd.onCTAClick();};})();""",
    'web': """(function(){var url=function(){return /iphone|ipad|ipod/i.test(navigator.userAgent)?STORE.ios:STORE.android;};
window.__openStore=function(){window.open(url(),'_blank');};})();""",
}

MINIFY = """const fs=require('fs');const e=require(process.argv[1]+'/node_modules/esbuild');
const src=fs.readFileSync(0,'utf8');process.stdout.write(e.transformSync(src,{minify:true,loader:'js',target:'es2019'}).code);"""


def minify(src):
    """esbuild from the skill (real minification, ~50% smaller); falls back to dropping comment lines."""
    if os.path.isdir(os.path.join(SKILL, 'node_modules', 'esbuild')):
        r = subprocess.run(['node', '-e', MINIFY, SKILL], input=src.encode('utf-8'), capture_output=True)
        if r.returncode == 0: return r.stdout.decode('utf-8')
        print('  ! esbuild failed, shipping unminified: ' + r.stderr.decode('utf-8', 'replace')[:300])
    return '\n'.join(l for l in src.splitlines() if l.strip() and not l.strip().startswith('//'))


def three_slim(out):
    """tree-shaken three.js with only the exports the game uses (~150 KB less); None → ship vendor/three.min.js"""
    js = os.path.join(SKILL, 'scripts', 'three_slim.mjs')
    if not os.path.exists(js): return None
    r = subprocess.run(['node', js, LIVE, out], capture_output=True, text=True)
    if r.returncode: print('  ! three slim failed, shipping the full vendor build: ' + r.stderr[:300]); return None
    return open(out, encoding='utf-8').read()


def encode(name, kind, maxpx):
    im = Image.open(os.path.join(LIVE, 'assets', name + '.png'))
    k = min(1.0, maxpx / max(im.size))
    if k < 1: im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    buf = io.BytesIO()
    if kind == 'lossy': im.convert('RGB').save(buf, 'WEBP', quality=78, method=6)
    else: im.convert('RGBA').save(buf, 'WEBP', quality=86, alpha_quality=90, method=6)
    return buf.getvalue()


def build(variant, nets, out, slim=True):
    vdir = os.path.join(out, variant); os.makedirs(vdir, exist_ok=True)
    page = open(os.path.join(LIVE, 'index.html'), encoding='utf-8').read()
    files = json.loads(re.search(r"const FILES = (\[[^\]]*\])", page).group(1).replace("'", '"'))
    imgs, glbs, rows = {}, {}, []
    for n, (mx, kind) in CFG.get('images', {}).items():
        if not os.path.exists(os.path.join(LIVE, 'assets', n + '.png')): print(f'  ! image {n} missing (live/assets/{n}.png)'); return False
        d = encode(n, kind, mx); imgs[n] = 'data:image/webp;base64,' + base64.b64encode(d).decode(); rows.append(('image ' + n, len(d)))
    for n in CFG.get('models', {}):
        p = os.path.join(LIVE, 'models', n + '.glb')
        if not os.path.exists(p): print(f'  ! model {n} missing (live/models/{n}.glb)'); return False
        d = open(p, 'rb').read(); glbs[n] = base64.b64encode(d).decode(); rows.append(('model ' + n, len(d)))
    src = {f: open(os.path.join(LIVE, f), encoding='utf-8').read() for f in files}
    for n in re.findall(r"KIT\.model\('([^']+)'\)", ''.join(src.values())):
        if n not in glbs: print(f'  ! code loads model {n} not listed in tools/build.json "models"'); return False
    vendor = (slim and three_slim(os.path.join(out, '.three.slim.js'))) or ''.join(src[f] for f in files if f.startswith('vendor/'))
    game = minify('\n;\n'.join(src[f] for f in files if not f.startswith('vendor/')))
    rows = [('three.js (' + ('tree-shaken' if slim and len(vendor) < 800_000 else 'full vendor') + ')', len(vendor.encode())), ('game code (minified)', len(game.encode()))] + rows
    vfile = os.path.join(ROOT, 'variants', variant + '.json')
    over = json.load(open(vfile, encoding='utf-8')) if os.path.exists(vfile) else {}
    vjs = f"Object.assign(SIM.K, {json.dumps(over.get('K', {}))}); window.VARIANT = {json.dumps(dict(over, name=variant))};"
    # variant overrides run right after the game modules (they read SIM.K at step/draw time, never at load time)
    m = re.search(r'<script>\n(.*)</script></body>', page, re.S); boot = m.group(1)
    head = page[:m.start()].replace('<title>live</title>', '<title>' + TITLE + '</title>')
    head = head.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">')
    head = re.sub(r'<div id="hint">.*?</div>', '<div id="hint"></div>', head)
    safe = lambda js: js.replace('</script', '<\\/script')
    report = [f'# Build report — variant `{variant}` (3D, three.js)', '', '| network | file | size | limit | ok |', '|---|---|---|---|---|']
    ok_all = True
    for net in nets:
        cfg = NETWORKS[net]; tags = ''
        if cfg['mraid_tag']: tags += '<script src="mraid.js"></script>'
        if cfg['adapter'] == 'exitapi':
            tags += '<meta name="ad.orientation" content="portrait"><script type="text/javascript" src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>'
        pre = (f'<script>window.__STATIC__=1;window.__AD__=1;window.__INLINE__=1;var STORE={json.dumps(STORE)};window.BUILD={json.dumps(CFG)};'
               f'window.__IMG__={json.dumps(imgs)};window.__GLB__={json.dumps(glbs)};</script>')
        html = (head.replace('</head>', tags + '</head>') + pre + '<script>' + safe(vendor) + '</script><script>' + safe(game) + '\n' + vjs + '</script>'
                + '<script>' + ADAPTERS[cfg['adapter']] + '</script>' + '<script>\n' + boot + '</script></body></html>')
        ext = [u for u in re.findall(r'(?:src|href)="([^"]+)"', head + tags + boot) if not u.startswith('data:')]
        bad = [u for u in ext if u not in ALLOWED_EXTERNAL]
        if cfg.get('zip'):
            path = os.path.join(vdir, net + '.zip')
            with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z: z.writestr('index.html', html)
        else:
            path = os.path.join(vdir, net + '.html'); open(path, 'w', encoding='utf-8').write(html)
        size = os.path.getsize(path); ok = size <= cfg['limit'] and not bad; ok_all &= ok
        report.append(f"| {net} | `{os.path.basename(path)}` | {size / 1e6:.2f} MB | {cfg['limit'] / 1e6:.0f} MB | {'yes' if ok else 'NO ' + ', '.join(bad)} |")
        print(f'  {net:11s} {size / 1e6:6.2f} MB  {"ok" if ok else "FAIL " + str(bad)}')
    report += ['', '## What the bytes are (before base64 for images/models, +33% inline)', '', '| part | size |', '|---|---|']
    report += [f'| {n} | {b / 1e3:.0f} KB |' for n, b in rows]
    open(os.path.join(vdir, 'report.md'), 'w', encoding='utf-8').write('\n'.join(report) + '\n')
    print('  ' + ', '.join(f'{n} {b / 1e3:.0f} KB' for n, b in rows) + f' -> {vdir}/report.md')
    return ok_all


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--variant', default='default'); ap.add_argument('--networks', default='all'); ap.add_argument('--out', default=os.path.join(ROOT, 'dist'))
    ap.add_argument('--full-three', action='store_true', help='ship vendor/three.min.js instead of the tree-shaken build')
    ap.add_argument('--pages', help="also copy each variant's preview build here (GitHub Pages: default -> index.html)")
    a = ap.parse_args()
    nets = list(NETWORKS) if a.networks == 'all' else a.networks.split(',')
    variants = [v[:-5] for v in sorted(os.listdir(os.path.join(ROOT, 'variants')))] if a.variant == 'all' else [a.variant]
    ok = True
    for v in variants: print(f'variant {v}:'); ok &= build(v, nets, a.out, slim=not a.full_three)
    if a.pages and 'preview' in nets:
        import shutil; os.makedirs(a.pages, exist_ok=True)
        for v in variants: shutil.copy(os.path.join(a.out, v, 'preview.html'), os.path.join(a.pages, 'index.html' if v == 'default' else v + '.html'))
        print(f'  pages -> {a.pages}')
    sys.exit(0 if ok else 1)
