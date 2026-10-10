// live/scene.js — TIMBER RUSH 3D world (GAME part): draws SIM state with three.js; the HUD on top is hud.js.
// Contract used by index.html / tools: SCENE.init(glCanvas, hudCanvas, VW, VH) → Promise, SCENE.render(t), SCENE.state,
// SCENE.hit (tappable HUD rects, from hud.js), SCENE.stats(), SCENE.probe(), SCENE.QA(), SCENE.proj(xPx, yPx, hM).
// World mapping: sim px → metres with U (x → X, y → Z, heading 0 = up the screen = −Z). Everything is a pure function of
// (state, t) — render.mjs renders any time t of the attract demo.
(function () {
  const T = THREE, S = (window.SCENE = { state: null, hit: [] }), U = 0.01;
  const K = () => SIM.K, PAD = SIM.PAD, BASE = SIM.BASE, WORLD = SIM.WORLD;
  const COL = { ground: 0x9ccc5a, floor: 0x5f8f34, yard: 0xc9c2b2, yardLine: 0xf2d43c, body: 0xf6c21c, rival: 0xd8402e,
    dark: 0x34373b, tire: 0x262626, hub: 0xf2c21a, glass: 0x2b4d6e, roof: 0xf4f4f0, bar: 0xd8382a, blade: 0xd5dde3,
    log: 0x9a6334, trunk: 0x6b4426, leaf: [0x245a22, 0x4a9a36, 0x6cb844], dust: 0xe0c27a, smoke: 0x6a6c68, sky: 0x2f5222 };
  let R, scene, cam, sun, field, stumps, fallers, bits, smoke, applied, P, RV, worker, end = {}, VW = 1080, VH = 1920;
  const ease = (x) => 1 - (1 - x) * (1 - x), clamp = (x, a, b) => Math.max(a, Math.min(b, x)), SS = (a, b, x) => { const q = clamp((x - a) / (b - a), 0, 1); return q * q * (3 - 2 * q); };
  const h1 = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

  // ---------------- procedural kit ----------------
  function treeGeo() {                                    // low-poly pine, ~20 tris, vertex colours, base at y = 0
    const parts = [K_.paint(new T.CylinderGeometry(0.05, 0.07, 0.4, 4).translate(0, 0.2, 0), COL.trunk)];
    [[0.36, 0.7, 0.3, COL.leaf[0]], [0.25, 0.62, 0.78, COL.leaf[1]]].forEach(([r, h, y, c]) =>
      parts.push(K_.paint(new T.ConeGeometry(r, h, 6, 1, true).translate(0, y + h / 2, 0), c)));
    return T.BufferGeometryUtils.mergeGeometries(parts);
  }
  const treeLow = () => K_.paint(new T.ConeGeometry(0.36, 1.25, 5, 1, true).translate(0, 0.62, 0), COL.leaf[1]);   // far LOD, 5 tris
  function harvester(bodyCol) {                           // facing −Z; static body merged (1 draw), wheels + cutter animated
    const g = new T.Group(), st = new T.Group(), b = K_.box, c = K_.cyl;
    st.add(b(1.5, 0.3, 2.5, COL.dark, [0, 0.55, 0.1]), b(1.35, 0.7, 1.1, bodyCol, [0, 1.0, 0.75]), b(1.1, 0.12, 0.8, COL.dark, [0, 1.41, 0.75]),
      b(1.05, 0.85, 1.0, bodyCol, [0, 1.25, -0.25]), b(1.2, 0.1, 1.15, COL.roof, [0, 1.72, -0.25]), b(0.9, 0.5, 0.03, COL.glass, [0, 1.36, -0.76]),
      b(0.03, 0.45, 0.75, COL.glass, [0.535, 1.36, -0.25]), b(0.03, 0.45, 0.75, COL.glass, [-0.535, 1.36, -0.25]),
      c(0.06, 0.06, 0.6, 8, COL.dark, [0.45, 1.65, 0.95]), b(0.16, 0.12, 0.16, 0xff9a1f, [0, 1.83, -0.25]),
      b(0.12, 0.12, 0.8, COL.dark, [0.5, 0.6, -1.0]), b(0.12, 0.12, 0.8, COL.dark, [-0.5, 0.6, -1.0]));
    const body = K_.merge(st); g.add(body);
    const wheels = [[0.78, 0.42, -0.45], [-0.78, 0.42, -0.45], [0.78, 0.42, 0.75], [-0.78, 0.42, 0.75]];   // drawn by S.wheels (pool)
    const cut = new T.Group(); cut.position.set(0, 0, -1.32);
    const bar = K_.merge((() => { const q = new T.Group(); q.add(b(1, 0.32, 0.34, COL.bar, [0, 0.45, 0]), b(1, 0.06, 0.5, 0xa82a1e, [0, 0.64, -0.05])); return q; })());
    cut.add(bar);
    g.add(cut);
    return { g, body, wheels, cut, bar, trailers: [] };
  }
  function trailer(bodyCol) {
    const q = new T.Group(), b = K_.box, c = K_.cyl;
    q.add(b(1.25, 0.18, 1.3, COL.dark, [0, 0.5, 0]), b(1.35, 0.3, 1.35, bodyCol, [0, 0.72, 0]), b(0.1, 0.1, 0.5, COL.dark, [0, 0.5, -0.85]));
    for (let k = 0; k < 6; k++) q.add(c(0.15, 0.15, 1.2, 7, k % 2 ? COL.log : 0xb07a46, [-0.32 + (k % 3) * 0.32, 1.0 + Math.floor(k / 3) * 0.26, 0], [Math.PI / 2, 0, 0]));
    for (const x of [0.7, -0.7]) q.add(c(0.3, 0.3, 0.24, 10, COL.tire, [x, 0.3, 0.1], [0, 0, Math.PI / 2]));
    return K_.merge(q).geometry;
  }
  let K_;

  // ---------------- init ----------------
  S.init = async (gl, hudCv, W, H) => {
    K_ = KIT; VW = W; VH = H; R = KIT.renderer(gl, W, H); R.info.autoReset = false; KIT.H.init(hudCv, W, H);   // info: stats cover the whole frame (world + endcard passes)
    scene = new T.Scene(); scene.background = new T.Color(COL.sky);
    cam = new T.PerspectiveCamera(42, W / H, 0.5, 120);
    scene.add(new T.HemisphereLight(0xeaf6ff, 0x4d6a2a, 1.25));
    sun = new T.DirectionalLight(0xfff1d6, 3.2); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 50 }); sun.shadow.bias = -0.0015; sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    // ground: light mowed grass everywhere (cleared = lighter), darker floor under the forest, concrete yard at the base
    const wx = (WORLD.x1 - WORLD.x0) * U, wz = (WORLD.y1 - WORLD.y0) * U;
    const gnd = new T.Mesh(new T.PlaneGeometry(wx + 40, wz + 40), KIT.mat(COL.ground)); gnd.rotation.x = -Math.PI / 2; gnd.position.set(wx / 2, 0, wz / 2); gnd.receiveShadow = true; scene.add(gnd);
    const yard = new T.Mesh(new T.BoxGeometry((BASE.x1 - BASE.x0) * U, 0.06, (BASE.y1 - BASE.y0) * U), KIT.mat(COL.yard)); yard.position.set((BASE.x0 + BASE.x1) / 2 * U, 0.03, (BASE.y0 + BASE.y1) / 2 * U); yard.receiveShadow = true; scene.add(yard);
    // the upgrade pad: yellow-black ring + progress arc (rebuilt only when the paid fraction changes)
    const pr = PAD.r * U; S.pad = new T.Group(); S.pad.position.set(PAD.x * U, 0.07, PAD.y * U); scene.add(S.pad);
    const ring = new T.Mesh(new T.RingGeometry(pr * 0.78, pr, 32), KIT.mat(0x2a2a2a, { side: T.DoubleSide })); ring.rotation.x = -Math.PI / 2; S.pad.add(ring);
    const disc = new T.Mesh(new T.CircleGeometry(pr * 0.78, 32), KIT.mat(0xf2d43c)); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.005; disc.receiveShadow = true; S.pad.add(disc);
    S.padArc = new T.Mesh(new T.BufferGeometry(), KIT.mat(0x4fd14a, { side: T.DoubleSide })); S.padArc.rotation.x = -Math.PI / 2; S.padArc.position.y = 0.01; S.pad.add(S.padArc); S.padFrac = -1;
    // forest: 9k pines in chunked instances; stumps appear where a tree was cut
    const geo = treeGeo(), items = SIM.TREES.map((tr, i) => ({ x: tr[0] * U, z: tr[1] * U, ry: h1(i) * 6.28, s: 0.75 + (tr[3] - 0.9) * 2.4 + 0.25 * h1(i + 5), col: [0xffffff, 0xf2ffc0, 0xb0d8b8][tr[2]] }));
    field = new KIT.Field(scene, geo, KIT.vmat, items, 4.8, { shadow: true, lod: { geo: treeLow(), near: 13 } });
    stumps = new T.InstancedMesh(KIT.paint(new T.CylinderGeometry(0.07, 0.085, 0.09, 6).translate(0, 0.045, 0), 0xc9b483), KIT.vmat, SIM.TREES.length);
    stumps.count = 0; stumps.frustumCulled = false; stumps.receiveShadow = true; scene.add(stumps); S.items = items;
    applied = new Float32Array(SIM.TREES.length).fill(-1);
    SIM.TREES.forEach((tr, i) => { if (!tr[4]) { field.show(i, false); applied[i] = -2; } });
    field.flush(0, 0);
    const tire = new T.Group(); tire.add(KIT.cyl(0.42, 0.42, 0.32, 10, COL.tire, [0, 0, 0], [0, 0, Math.PI / 2]), KIT.cyl(0.2, 0.2, 0.34, 6, COL.hub, [0, 0, 0], [0, 0, Math.PI / 2]));
    S.wheels = new KIT.Pool(scene, KIT.merge(tire).geometry, KIT.vmat, 16, { shadow: true });
    S.blades = new KIT.Pool(scene, KIT.paint(new T.CylinderGeometry(0.2, 0.2, 0.04, 10), COL.blade), KIT.vmat, 16);
    fallers = new KIT.Pool(scene, geo, KIT.vmat, 220, { shadow: true });
    bits = new KIT.Pool(scene, new T.BoxGeometry(1, 1, 1), new T.MeshLambertMaterial({ flatShading: true }), 600);
    smoke = new KIT.Pool(scene, new T.IcosahedronGeometry(1, 0), new T.MeshLambertMaterial({ flatShading: true, transparent: true, opacity: 0.55 }), 40);
    // machines (player yellow, rival red); trailers are made on demand
    P = harvester(COL.body); RV = harvester(COL.rival); scene.add(P.g, RV.g);
    S.trailerGeo = { p: trailer(COL.body), r: trailer(COL.rival) };
    S.darkMat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: 0x555555 });
    // the worker (CC0 skinned model): waves from the yard in the world, and again on the endcard
    for (const n of Object.keys((window.BUILD || {}).images || {})) KIT.H.img[n] = await KIT.image(n);
    const wg = await KIT.model('worker');
    worker = KIT.rig(wg); worker.root.scale.setScalar(0.85); worker.root.position.set((PAD.x + 190) * U, 0.06, (PAD.y + 60) * U); worker.root.rotation.y = -0.5; scene.add(worker.root);
    end.scene = new T.Scene(); end.cam = new T.PerspectiveCamera(30, W / H, 0.1, 100);
    end.scene.add(new T.HemisphereLight(0xffffff, 0x886644, 2.2)); const l = new T.DirectionalLight(0xffffff, 2); l.position.set(2, 4, 5); end.scene.add(l);
    end.rig = KIT.rig(wg, { shadow: false }); end.scene.add(end.rig.root);
    const pod = new T.Group(); pod.add(KIT.cyl(0.62, 0.7, 0.42, 12, 0x8a5a32, [0, -0.21, 0]), KIT.cyl(0.6, 0.6, 0.02, 12, 0xe0b878, [0, 0.0, 0])); end.pod = KIT.merge(pod); end.scene.add(end.pod);
    end.dim = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ color: 0x06100a, transparent: true, depthTest: false }));
    end.dim.position.z = -0.5; end.dimScene = new T.Scene(); end.dimScene.add(end.dim); end.dimCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return S;
  };

  // ---------------- per-frame ----------------
  function placeMachine(M, m, t, red) {
    if (!m) { M.g.visible = false; M.trailers.forEach((x) => (x.visible = false)); return; }
    M.g.visible = true;
    const deadA = m.alive ? 0 : clamp((t - m.deadT) / 0.5, 0, 1), cutting = t - m.cutT < 0.12;
    M.g.position.set(m.x * U, (cutting ? 0.025 * Math.sin(t * 70) : 0) - deadA * 0.35, m.y * U);
    M.g.rotation.set(0, -m.a, deadA * 0.5);
    const lv = Math.min(m.lv, 4), w = K().CUT_W[lv] * U, up = red ? 0 : Math.max(0, 1 - (t - (S.cur.upT || -9)) / 0.35);
    M.g.scale.set(1 + 0.12 * up, 1 + 0.2 * up * Math.sin(up * 9), 1 + 0.12 * up);
    M.bar.scale.x = w; M.g.updateMatrixWorld();
    const wm = M.g.matrixWorld, l4 = new T.Matrix4(), r4 = new T.Matrix4();
    for (let j = 0; j < 6; j++) S.blades.addMatrix(l4.multiplyMatrices(wm, r4.makeTranslation((-0.5 + (j + 0.5) / 6) * w * 0.9, 0.24, -1.44)).multiply(new T.Matrix4().makeRotationY(t * 28 + j)));
    for (const [x, y, z] of M.wheels) S.wheels.addMatrix(l4.multiplyMatrices(wm, r4.makeTranslation(x, y, z)).multiply(new T.Matrix4().makeRotationX(-m.dist * U / 0.42)));
    M.body.material = m.alive ? KIT.vmat : S.darkMat;
    const n = SIM.trailers(m);
    while (M.trailers.length < n) { const tm = new T.Mesh(red ? S.trailerGeo.r : S.trailerGeo.p, KIT.vmat); tm.castShadow = tm.receiveShadow = true; scene.add(tm); M.trailers.push(tm); }
    M.trailers.forEach((tm, k) => { tm.visible = k < n; if (k >= n) return; const [x, y, a] = SIM.alongTrail(m, K().TRAILER_GAP * (k + 1) + 30);
      tm.position.set(x * U, -deadA * 0.35, y * U); tm.rotation.set(0, -a, 0); tm.material = m.alive ? KIT.vmat : S.darkMat; });
  }

  S.render = (t) => {
    const ST = S.state || SIM.at(t), GT = ST.t, p = ST.p, rv = ST.rv; S.cur = ST;
    // ---- forest state: diff the sim's cut[] against what is drawn (works for live play and the looping demo) ----
    let rebuild = false; const sm4 = new T.Matrix4(), addStump = (i) => { const it = S.items[i]; sm4.makeTranslation(it.x, 0, it.z); stumps.setMatrixAt(stumps.count++, sm4); };
    for (let i = 0; i < applied.length; i++) { const c = ST.cut[i]; if (c === applied[i] || (c >= 0 && applied[i] >= 0)) continue;
      if (c === -1) { field.show(i, true); rebuild = true; } else if (c >= 0) { field.show(i, false); addStump(i); }
      applied[i] = c; }
    if (rebuild) { stumps.count = 0; for (let i = 0; i < applied.length; i++) if (applied[i] >= 0) addStump(i); }
    field.flush(ST.cam[0] * U, ST.cam[1] * U); stumps.instanceMatrix.needsUpdate = true;
    // ---- falling trees + sawdust/needles + smash debris (stateless: from recent events) ----
    fallers.begin(); bits.begin();
    const m4 = new T.Matrix4(), q = new T.Quaternion(), ax = new T.Vector3();
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0) continue;
      if (e.k === 'cut' && a < 0.9) { const s = S.items[e.i].s, dx = Math.cos(e.fa), dz = Math.sin(e.fa);
        ax.set(dz, 0, -dx).normalize(); const fall = Math.PI / 2 * Math.min(1, Math.pow(a / 0.42, 2)), k = 1 - SS(0.55, 0.9, a);
        q.setFromAxisAngle(ax, fall); m4.compose(new T.Vector3(e.x * U, 0.02, e.y * U), q, new T.Vector3(s * k, s * k, s * k)); fallers.addMatrix(m4);
        if (a < 0.6) for (let j = 0; j < 4; j++) { const r1 = h1(e.i * 7 + j), r2 = h1(e.i * 13 + j), an = r1 * 6.28, v = 0.6 + r2 * 0.9;
          bits.add(e.x * U + Math.cos(an) * v * a, 0.25 + 2.6 * a - 5 * a * a, e.y * U + Math.sin(an) * v * a, 0.07 * (1 - a / 0.6), 0.07 * (1 - a / 0.6), 0.07 * (1 - a / 0.6), a * 9, an, 0, j % 2 ? COL.dust : COL.leaf[2]); } }
      if (e.k === 'smash' && a < 1.4) for (let j = 0; j < 22; j++) { const an = j * 2.4, v = 2 + h1(j) * 3, k = 1 - SS(0.9, 1.4, a);
        bits.add(e.rx * U + Math.cos(an) * v * a, Math.max(0.1, 0.5 + 6 * a - 9 * a * a), e.ry * U + Math.sin(an) * v * a, 0.25 * k, 0.18 * k, 0.3 * k, a * 7 + j, a * 5, 0, j % 3 ? COL.rival : COL.dark); }
      if (e.k === 'upgrade' && a < 0.8) for (let j = 0; j < 18; j++) { const an = j / 18 * 6.28, r = PAD.r * U * (0.8 + 2.2 * ease(a / 0.8));
        bits.add(PAD.x * U + Math.cos(an) * r, 0.15 + 0.6 * Math.sin(a * 4), PAD.y * U + Math.sin(an) * r, 0.12, 0.12, 0.12, a * 6, an, 0, 0xffe066); } }
    fallers.end(); bits.end();
    // ---- machines, trailers, exhaust smoke ----
    S.wheels.begin(); S.blades.begin(); placeMachine(P, p, GT, false); placeMachine(RV, rv, GT, true); S.wheels.end(); S.blades.end();
    smoke.begin();
    for (const [M, m] of [[P, p], [RV, rv]]) { if (!m || !m.alive) continue; const ex = new T.Vector3(0.45, 1.95, 0.95).applyMatrix4(M.g.matrixWorld);
      for (let k = 0; k < 5; k++) { const ph = (GT * 1.6 + k / 5) % 1; smoke.add(ex.x + ph * 0.3, ex.y + ph * 1.2, ex.z + ph * 0.5, 0.08 + 0.22 * ph, 0.08 + 0.22 * ph, 0.08 + 0.22 * ph, 0, ph * 3, 0, COL.smoke); } }
    smoke.end(); smoke.im.material.opacity = 0.5;
    // ---- pad progress arc ----
    const cost = K().PAD_COST[ST.padLv], frac = cost < 999 ? clamp(ST.padPaid / cost, 0, 1) : 1, fq = Math.round(frac * 48) / 48;
    if (fq !== S.padFrac) { S.padFrac = fq; S.padArc.geometry.dispose(); S.padArc.geometry = new T.RingGeometry(PAD.r * U * 0.8, PAD.r * U * 0.98, 32, 1, Math.PI / 2, -Math.max(0.001, fq) * Math.PI * 2); }
    S.pad.visible = cost < 999 || ST.end < 0;
    // ---- the worker in the yard ----
    const near = Math.hypot(p.x - PAD.x, p.y - PAD.y) < 520; worker.play(near || GT < 3 ? 'Wave' : 'Idle', GT);
    worker.root.rotation.y = Math.atan2(p.x - (PAD.x + 190), p.y - (PAD.y + 60));
    // ---- camera: the sim's 2D camera (look-at point + zoom) becomes a tilted follow camera; trauma shake from events ----
    let tr = 0; for (const e of ST.ev) { const a = GT - e.t; if (a < 0) continue;
      if (e.k === 'smash' && a < 0.6) tr = Math.max(tr, 1 - a / 0.6); if (e.k === 'bump' && a < 0.35) tr = Math.max(tr, 0.55 * (1 - a / 0.35));
      if (e.k === 'upgrade' && a < 0.3) tr = Math.max(tr, 0.35 * (1 - a / 0.3)); }
    const sh = 0.25 * tr * tr, tx = ST.cam[0] * U + sh * Math.sin(GT * 83), tz = ST.cam[1] * U + sh * Math.sin(GT * 101 + 1);
    const dist = 23 * 1.45 / ST.zoom, pitch = 0.92;             // ~53° down: reads as 3D, still shows the forest ahead
    cam.position.set(tx, Math.sin(pitch) * dist, tz + Math.cos(pitch) * dist); cam.lookAt(tx, 0, tz);
    sun.position.set(tx - 6, 14, tz + 5); sun.target.position.set(tx, 0, tz - 2); sun.target.updateMatrixWorld();
    R.info.reset(); R.autoClear = true; R.render(scene, cam);
    // ---- endcard: dim the world in 3D, then the waving worker on top (HUD text and buttons come from hud.js) ----
    if (ST.end >= 0) { const a = GT - ST.end, k = SS(0, 0.45, a), sm = clamp((a - 0.35) / 0.35, 0, 1);
      end.dim.material.opacity = 0.82 * k; R.autoClear = false; R.render(end.dimScene, end.dimCam);
      if (sm > 0) { const oy = (VH - 1920) / 2, yf = 1070 + oy, yh = yf - 520 * (sm < 1 ? 1.12 * ease(sm) - 0.12 * sm * sm : 1), A = Math.tan(15 * Math.PI / 180);
        const dA = VH * 1.86 * 0.85 / (2 * (yf - yh)), d = dA / A, cy = (2 * yf / VH - 1) * dA;  // feet at yf, head at yh (view px)
        end.rig.root.scale.setScalar(0.85); end.rig.root.position.y = 0.01; end.rig.play(ST.endWhy === 'win' ? 'Wave' : 'Idle', a); end.rig.root.rotation.y = 0.25 * Math.sin(GT * 0.8);
        end.cam.position.set(0, cy, d); end.cam.lookAt(0, cy, 0); R.clearDepth(); R.render(end.scene, end.cam); }
      R.autoClear = true; }
    S.proj = (x, y, h) => KIT.proj(cam, x * U, h, y * U, VW, VH);
    HUD.draw(ST, t, S.proj);
    S.hit = HUD.hit;
  };

  S.stats = () => ({ calls: R.info.render.calls, tris: R.info.render.triangles });
  // numbers instead of screenshots: draw calls, triangles, the hero's screen box (share of the view), HUD boxes off-screen / overlapping
  S.probe = () => { const b = KIT.screenBox(cam, P.g, VW, VH), c = HUD.check();
    return { calls: R.info.render.calls, tris: R.info.render.triangles, hero: b, heroH: b ? +((b[3] - b[1]) / VH * 100).toFixed(1) : 0,
      heroOn: !!b && b[0] >= 0 && b[2] <= VW && b[1] >= 0 && b[3] <= VH, hudOut: c.out, hudOverlap: c.ov }; };
  // QA states (staged from the attract replay where they happen naturally) — tools/probe and the critic use these
  S.QA = () => { const at = (tt, o = {}) => Object.assign(JSON.parse(JSON.stringify(SIM.at(tt))), o);   // deep copy: SIM.at reuses its cache
    return [['start', at(0.3)], ['mow', at(4)], ['pad', at(7.7)], ['rival', at(16)], ['smash', at(21.6)], ['end', at(26)], ['money_worst', at(9, { money: 99999 })]]; };
})();
