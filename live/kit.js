// live/kit.js — GENERIC 3D + HUD helpers for playables (keep across games; the game lives in scene.js / hud.js).
//   KIT.renderer(canvas, VW, VH)  WebGL renderer sized to the CSS box × min(DPR, 2), sRGB, soft shadows
//   KIT.image(name) / KIT.model(name)  inline in the build (window.__IMG__ / __GLB__), files in dev (assets/, models/)
//   KIT.rig(gltf)                  clone a (skinned) model + deterministic clip playback: r.play('Wave', t)
//   KIT.mat(hex) / KIT.part(...)   flat-shaded vertex-colour parts; KIT.merge(group) → ONE mesh (one draw call)
//   KIT.Field                      thousands of static instances in chunks (frustum-culled, optional far LOD), show/hide by index
//   KIT.Pool                       per-frame instanced FX (particles, falling props): begin / add / end
//   KIT.proj(camera, x, y, z)      world → view px (VW×VH) or null behind the camera
//   KIT.H                          Canvas2D HUD primitives in view px: label, pill, img, glow, ring, box registry for QA
(function () {
  const T = THREE, K = (window.KIT = {}), V = Date.now();

  // ---------------- renderer ----------------
  K.renderer = (cv, VW, VH) => {
    const r = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.outputColorSpace = T.SRGBColorSpace; r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    const fit = () => { const b = cv.getBoundingClientRect(), k = Math.min(window.devicePixelRatio || 1, 2);
      let w = Math.round((b.width || VW / 2) * k), h = Math.round(w * VH / VW); if (h > VH) { h = VH; w = VW; }   // never above the design size
      if (/[?&]render/.test(location.search)) { w = VW; h = VH; }        // offline renders / probe: full design resolution
      if (cv.width !== w || cv.height !== h) r.setSize(w, h, false); };
    fit(); addEventListener('resize', fit); r.fit = fit; return r;
  };

  // ---------------- assets: inline in the single-file build, files in dev ----------------
  K.image = (n) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image ' + n));
    im.src = (window.__IMG__ && window.__IMG__[n]) || 'assets/' + n + '.png?v=' + V; });
  const b64 = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  K.model = async (n) => {
    const buf = window.__GLB__ && window.__GLB__[n] ? b64(window.__GLB__[n]) : await (await fetch('models/' + n + '.glb?v=' + V)).arrayBuffer();
    const L = new T.GLTFLoader(); L.setMeshoptDecoder(T.MeshoptDecoder); return L.parseAsync(buf, '');
  };
  // a placed copy of a model with its own skeleton; play(name, t) is a pure function of t (render.mjs needs that)
  K.rig = (gltf, opts = {}) => {
    const root = T.SkeletonUtils.clone(gltf.scene), mixer = new T.AnimationMixer(root), acts = {};
    root.traverse((o) => { if (o.isMesh) { o.castShadow = opts.shadow !== false; o.frustumCulled = false; if (opts.tint) o.material = o.material.clone(); } });
    for (const c of gltf.animations) acts[c.name] = mixer.clipAction(c);
    let cur = null;
    return { root, mixer, acts, clips: Object.keys(acts),
      play(name, t, fade = 0) {                       // t = seconds since this clip started (loops)
        const a = acts[name]; if (!a) return;
        if (cur !== a) { if (cur) cur.stop(); a.reset().play(); cur = a; }
        a.time = (t % a.getClip().duration + a.getClip().duration) % a.getClip().duration; mixer.update(0); void fade; } };
  };

  // ---------------- procedural parts ----------------
  const mats = {};
  K.mat = (hex, o = {}) => { const k = hex + JSON.stringify(o); return mats[k] || (mats[k] = new T.MeshLambertMaterial(Object.assign({ color: hex, flatShading: true }, o))); };
  K.vmat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });          // for merged / vertex-coloured meshes
  // K.part(geometry, hex, [x,y,z], [rx,ry,rz], [sx,sy,sz]) → Mesh (flat colour)
  K.part = (g, hex, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => { const m = new T.Mesh(g, K.mat(hex)); m.position.set(...p); m.rotation.set(...r); m.scale.set(...s); m.castShadow = m.receiveShadow = true; return m; };
  K.box = (w, h, d, hex, p, r) => K.part(new T.BoxGeometry(w, h, d), hex, p, r);
  K.cyl = (rt, rb, h, seg, hex, p, r) => K.part(new T.CylinderGeometry(rt, rb, h, seg), hex, p, r);
  // paint a geometry with one colour (vertex attribute) so many parts can be merged into one draw call
  K.paint = (g, hex) => { g = g.index ? g.toNonIndexed() : g; const c = new T.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new T.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g; };
  // merge every Mesh under `group` (flat colours from their materials) into ONE vertex-coloured mesh
  K.merge = (group, mat = K.vmat) => {
    group.updateMatrixWorld(true); const inv = new T.Matrix4().copy(group.matrixWorld).invert(), gs = [];
    group.traverse((o) => { if (!o.isMesh) return; const g = K.paint(o.geometry.clone(), o.material.color.getHex()); g.applyMatrix4(new T.Matrix4().multiplyMatrices(inv, o.matrixWorld)); gs.push(g); });
    const m = new T.Mesh(T.BufferGeometryUtils.mergeGeometries(gs), mat); m.castShadow = m.receiveShadow = true; return m;
  };

  // ---------------- many static things: chunked instancing ----------------
  // items: [{x, z, ry, s, col}], one InstancedMesh per chunk (frustum culling per chunk), show(i, on) toggles one item
  K.Field = class {
    constructor(scene, geo, mat, items, chunk = 4, opts = {}) {
      this.items = items; this.slot = new Int32Array(items.length); this.chunkOf = new Int32Array(items.length); this.chunks = [];
      const by = new Map(), m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), col = new T.Color();
      items.forEach((it, i) => { const k = Math.floor(it.x / chunk) + ':' + Math.floor(it.z / chunk); if (!by.has(k)) by.set(k, []); by.get(k).push(i); });
      for (const ids of by.values()) {
        const im = new T.InstancedMesh(geo, mat, ids.length); im.castShadow = !!opts.shadow; im.receiveShadow = true;
        const c = this.chunks.length;
        ids.forEach((i, s) => { const it = items[i]; this.slot[i] = s; this.chunkOf[i] = c;
          m4.compose(new T.Vector3(it.x, it.y || 0, it.z), q.setFromEuler(e.set(0, it.ry || 0, 0)), new T.Vector3(it.s, it.s, it.s)); im.setMatrixAt(s, m4);
          if (it.col !== undefined) im.setColorAt(s, col.set(it.col)); });
        im.computeBoundingSphere(); scene.add(im);
        let lo = null;                                  // far LOD: a cheaper geometry sharing the same instance buffers
        if (opts.lod) { lo = new T.InstancedMesh(opts.lod.geo, mat, ids.length); lo.instanceMatrix = im.instanceMatrix; lo.instanceColor = im.instanceColor;
          lo.boundingSphere = im.boundingSphere; lo.receiveShadow = true; lo.visible = false; scene.add(lo); }
        this.chunks.push({ im, lo, c: im.boundingSphere.center, mats: ids.map((i) => { im.getMatrixAt(this.slot[i], m4); return m4.clone(); }), on: ids.length, dirty: false });
      }
      this.zero = new T.Matrix4().makeScale(0, 0, 0); this.lod = opts.lod;
    }
    show(i, on) { const ch = this.chunks[this.chunkOf[i]], s = this.slot[i]; ch.im.setMatrixAt(s, on ? ch.mats[s] : this.zero); ch.dirty = true; ch.on += on ? 1 : -1; }
    // call once per frame: uploads changed chunks, swaps chunks farther than lod.near from (x, z) to the cheap geometry
    flush(x, z) { const near = this.lod ? this.lod.near : 1e9;
      for (const ch of this.chunks) { if (ch.dirty) { ch.im.instanceMatrix.needsUpdate = true; ch.dirty = false; }
        const far = ch.lo && x !== undefined && Math.hypot(ch.c.x - x, ch.c.z - z) > near; ch.im.visible = ch.on > 0 && !far; if (ch.lo) ch.lo.visible = ch.on > 0 && far; } }
  };

  // ---------------- per-frame instanced FX ----------------
  K.Pool = class {
    constructor(scene, geo, mat, max, opts = {}) { this.im = new T.InstancedMesh(geo, mat, max); this.im.frustumCulled = false; this.im.castShadow = !!opts.shadow;
      this.max = max; this.n = 0; this.m4 = new T.Matrix4(); this.q = new T.Quaternion(); this.e = new T.Euler(); this.p = new T.Vector3(); this.s = new T.Vector3(); this.c = new T.Color();
      this.im.setColorAt(0, this.c.set(0xffffff)); scene.add(this.im); }
    begin() { this.n = 0; }
    add(x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, col) { if (this.n >= this.max) return;
      this.m4.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), this.s.set(sx, sy, sz)); this.im.setMatrixAt(this.n, this.m4);
      this.im.setColorAt(this.n, this.c.set(col === undefined ? 0xffffff : col)); this.n++; }
    addMatrix(m4, col) { if (this.n >= this.max) return; this.im.setMatrixAt(this.n, m4); this.im.setColorAt(this.n, this.c.set(col === undefined ? 0xffffff : col)); this.n++; }
    end() { this.im.count = this.n; this.im.instanceMatrix.needsUpdate = true; if (this.im.instanceColor) this.im.instanceColor.needsUpdate = true; this.im.visible = this.n > 0; }
  };

  const pv = new T.Vector3();
  K.proj = (cam, x, y, z, VW, VH) => { pv.set(x, y, z).project(cam); if (pv.z > 1) return null; return [(pv.x + 1) / 2 * VW, (1 - pv.y) / 2 * VH]; };
  // screen rect (view px) of an object's bounding box — used by the probe ("is the hero big enough / on screen?")
  K.screenBox = (cam, obj, VW, VH) => { const b = new T.Box3().setFromObject(obj); if (b.isEmpty()) return null; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < 8; i++) { const p = K.proj(cam, i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z, VW, VH); if (!p) continue;
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return x1 < x0 ? null : [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)]; };

  // ---------------- HUD (Canvas2D, view px) ----------------
  const H = (K.H = { ctx: null, W: 0, Hh: 0, img: {}, boxes: [], FONT: '"Arial Black","Segoe UI Black","Helvetica Neue",Arial,sans-serif' });
  H.init = (cv, W, Hh) => { cv.width = W; cv.height = Hh; H.ctx = cv.getContext('2d'); H.W = W; H.Hh = Hh; };
  H.begin = () => { H.ctx.setTransform(1, 0, 0, 1, 0, 0); H.ctx.clearRect(0, 0, H.W, H.Hh); H.boxes = []; };
  H.box = (id, x, y, w, h) => H.boxes.push({ id, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });   // QA registry
  H.rgba = (c, a = 1) => typeof c === 'string' ? c : `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
  H.rr = (x, y, w, h, r) => { const c = H.ctx; r = Math.min(r, h / 2, w / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  // rounded pill with a vertical gradient (top → bottom colour) and optional alpha
  H.pill = (x, y, w, h, r, top, bot, a = 1, id) => { const c = H.ctx, g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, H.rgba(top, a)); g.addColorStop(1, H.rgba(bot || top, a));
    c.fillStyle = g; H.rr(x, y, w, h, r); c.fill(); if (id) H.box(id, x, y, w, h); };
  // outlined label; al = 0 left, 0.5 centre, 1 right; y is the vertical centre. Returns the width.
  H.label = (txt, x, y, o = {}) => { const c = H.ctx, size = o.size || 48; c.font = `900 ${size}px ${H.FONT}`; c.textBaseline = 'middle';
    const w = c.measureText(txt).width, x0 = x - w * (o.al || 0); c.globalAlpha = o.a === undefined ? 1 : o.a;
    if (o.out) { c.lineJoin = 'round'; c.lineWidth = Math.max(4, size * 0.16); c.strokeStyle = o.out; c.strokeText(txt, x0, y); }
    c.fillStyle = o.col || '#fff'; c.fillText(txt, x0, y); c.globalAlpha = 1; if (o.id) H.box(o.id, x0, y - size * 0.6, w, size * 1.2); return w; };
  H.labelW = (txt, size) => { H.ctx.font = `900 ${size}px ${H.FONT}`; return H.ctx.measureText(txt).width; };
  H.sprite = (n, x, y, w, h, a = 1) => { const im = H.img[n]; if (!im) return; if (!h) h = w * im.height / im.width; H.ctx.globalAlpha = a; H.ctx.drawImage(im, x, y, w, h); H.ctx.globalAlpha = 1; };
  H.glow = (x, y, r, col, a) => { const c = H.ctx, g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, H.rgba(col, a)); g.addColorStop(1, H.rgba(col, 0)); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); };
  H.ring = (x, y, r, col, a, wd = 8) => { const c = H.ctx; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.lineWidth = wd; c.strokeStyle = H.rgba(col, a); c.stroke(); };
  H.dim = (a, col = [0, 0, 0]) => { H.ctx.fillStyle = H.rgba(col, a); H.ctx.fillRect(0, 0, H.W, H.Hh); };
  // QA: boxes that leave the screen, and overlapping pairs (ignores ids listed in `allow` and full-screen boxes)
  H.check = (allow = []) => { const out = [], ov = [], bs = H.boxes.filter((b) => b.w < H.W * 0.98 && !allow.includes(b.id));
    for (const b of bs) if (b.x < 0 || b.y < 0 || b.x + b.w > H.W || b.y + b.h > H.Hh) out.push(b.id);
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i], b = bs[j];
      if (a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) ov.push(a.id + '×' + b.id); }
    return { out, ov }; };
})();
