// live/sim.js — TIMBER RUSH playable ad: deterministic top-down sim, fixed 120 Hz.
// Loop: drag to steer the harvester → its cutter fells trees → coins → drive onto the upgrade pad → level + trailer →
// a red rival harvester invades → ram it once you out-level it → endcard. Every reaction lives here; the scene only draws.
(function (root) {
  const DT = 1 / 120, L = 30.0;
  const ASPECT = typeof window !== 'undefined' && window.innerWidth ? window.innerHeight / window.innerWidth : 16 / 9;
  const VIEW = { W: 1080, H: Math.round(1080 * Math.max(16 / 9, Math.min(19.5 / 9, ASPECT))) }, WORLD = { x0: 0, y0: 0, x1: 2160, y1: 3840 };
  const HINT = 'drag anywhere to drive · cut trees · upgrade on the yellow pad · ram the red rival';
  const K = {
    SPD: 330, ACC: 900, TURN: 5.2, JOY: 70,                 // top speed px/s, accel, turn rad/s, joystick full-throttle px
    CUT_FWD: 122, CUT_DEPTH: 30, CUT_W: [0, 205, 240, 275, 310], BODY_R: 72,
    TREE_VAL: 1, PAD_COST: [0, 200, 400, 999], PAD_RATE: 1.0, // pad drains its cost in ~1 s
    RIVAL_AT: 8, RIVAL_LV: 2, RIVAL_SPD: 165, HIT_R: 185, SMASH_BONUS: 500,
    END_AFTER_WIN: 1.6, END_MAX: 28, END_NO_INPUT: 12, END_IDLE: 10, TRAIL_STEP: 10, TRAIL_N: 260, TRAILER_GAP: 150,
  };

  // ---------------- the level, as data ----------------
  const SP = 30, NX = Math.floor(WORLD.x1 / SP), NY = Math.floor(WORLD.y1 / SP);
  const BASE = { x0: 140, y0: 3120, x1: 1020, y1: 3840 };                   // concrete yard (no trees)
  const PAD = { x: 580, y: 3290, r: 105 };                                  // the upgrade pad (re-arms with the next cost)
  const START = { x: 580, y: 3030, a: 0 };
  const h1 = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const TREES = [];                                                          // [x, y, variant, scale]; index = id
  for (let gy = 0; gy < NY; gy++) for (let gx = 0; gx < NX; gx++) {
    const i = gy * NX + gx, x = gx * SP + SP / 2 + (gy % 2 ? SP / 4 : -SP / 4) + 14 * (h1(i) - 0.5), y = gy * SP + SP / 2 + 12 * (h1(i + 0.3) - 0.5);
    const inBase = x > BASE.x0 - 30 && x < BASE.x1 + 30 && y > BASE.y0 - 40;
    const inStart = Math.hypot(x - START.x, (y - START.y) * 0.8) < 150 || (Math.abs(x - START.x) < 110 && y > START.y);
    TREES.push([x, y, Math.floor(h1(i + 0.7) * 3), 0.9 + 0.25 * h1(i + 0.9), !(inBase || inStart)]);
  }
  const treeAt = (gx, gy) => (gx < 0 || gy < 0 || gx >= NX || gy >= NY ? -1 : gy * NX + gx);

  const ss = (e0, e1, x) => { const q = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return q * q * (3 - 2 * q); };
  const angTo = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  const dirOf = (a) => [Math.sin(a), -Math.cos(a)];                          // heading 0 = up the screen

  const machine = (x, y, a, lv) => ({ x, y, a, v: 0, lv, trail: [[x, y]], dist: 0, cutT: -9, bumpT: -9, alive: true, deadT: -9 });
  function create() {
    return { t: 0, steps: 0, wt0: 0, ev: [], freeze: 0, cam: [START.x, START.y - 520], camV: [0, 0], zoom: 1.45,
      p: machine(START.x, START.y, START.a, 1), money: 0, earned: 0, padLv: 1, padPaid: 0, upT: -9,
      rv: null, winT: -9, end: -1, anc: null, lastIn: 0, firstIn: -1,
      cut: TREES.map((tr) => (tr[4] ? -1 : -2)), cutBy: {} };                // -1 standing, -2 never there, else cut time
  }
  const spawn = (worldT) => Object.assign(create(), { wt0: worldT });
  const respawn = (S, worldT) => spawn(worldT);
  const outOfPlay = () => false;

  // ---- cutting: everything inside the cutter bar (and under the body) falls; returns the number cut ----
  function cutAround(S, m, who) {
    const [dx, dy] = dirOf(m.a), cx = m.x + dx * K.CUT_FWD, cy = m.y + dy * K.CUT_FWD, w = K.CUT_W[Math.min(m.lv, 4)];
    const R = w / 2 + 40, g0x = Math.floor((cx - R) / SP) - 1, g1x = Math.floor((cx + R) / SP) + 1, g0y = Math.floor((cy - R) / SP) - 1, g1y = Math.floor((cy + R) / SP) + 1;
    let n = 0;
    for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) {
      const i = treeAt(gx, gy); if (i < 0 || S.cut[i] !== -1) continue;
      const [tx, ty] = TREES[i], rx = tx - cx, ry = ty - cy, along = rx * dx + ry * dy, across = rx * dy - ry * dx;
      const inBar = Math.abs(across) < w / 2 && along < K.CUT_DEPTH && along > -K.CUT_FWD - 20;
      const inBody = Math.hypot(tx - m.x, ty - m.y) < K.BODY_R;
      if (!inBar && !inBody) continue;
      S.cut[i] = S.t; n++;
      // fall direction: away from the machine, biased forward
      const side = Math.sign(across) || 1, fa = Math.atan2(dy + side * dx * 0.6, dx - side * dy * 0.6);
      S.ev.push({ k: 'cut', t: S.t, x: tx, y: ty, i, who, fa, coin: who === 'p' });
      if (who === 'p') { S.money += K.TREE_VAL; S.earned += K.TREE_VAL; S.felled = (S.felled || 0) + 1; }
    }
    if (n) m.cutT = S.t;
    return n;
  }

  // ---- drive one machine toward a joystick vector (jx, jy in -1..1) ----
  function drive(S, m, jx, jy, spd) {
    const mag = Math.min(1, Math.hypot(jx, jy));
    if (mag > 0.08) { const ta = Math.atan2(jx, -jy), d = angTo(m.a, ta); m.a += Math.max(-K.TURN * DT, Math.min(K.TURN * DT, d)); }
    const busy = S.t - m.cutT < 0.12 ? 0.82 : 1;                                 // the cutter bites: a touch slower in thick forest
    const tv = spd * mag * busy * (1 + 0.06 * (m.lv - 1));
    m.v += Math.max(-K.ACC * 1.6 * DT, Math.min(K.ACC * DT, tv - m.v));
    const [dx, dy] = dirOf(m.a);
    m.x = Math.max(WORLD.x0 + 60, Math.min(WORLD.x1 - 60, m.x + dx * m.v * DT));
    m.y = Math.max(WORLD.y0 + 60, Math.min(WORLD.y1 - 60, m.y + dy * m.v * DT));
    const last = m.trail[m.trail.length - 1];
    if (Math.hypot(m.x - last[0], m.y - last[1]) >= K.TRAIL_STEP) { m.trail.push([m.x, m.y]); if (m.trail.length > K.TRAIL_N) m.trail.shift(); }
    m.dist += m.v * DT;
  }
  // point at arc length s behind the machine along its trail (for trailers); also returns the heading there
  function alongTrail(m, s) {
    let px = m.x, py = m.y, acc = 0;
    for (let k = m.trail.length - 1; k >= 0; k--) {
      const [qx, qy] = m.trail[k], d = Math.hypot(px - qx, py - qy);
      if (acc + d >= s && d > 0) { const u = (s - acc) / d; const x = px + (qx - px) * u, y = py + (qy - py) * u; return [x, y, Math.atan2(px - qx, -(py - qy))]; }
      acc += d; px = qx; py = qy;
    }
    const [dx, dy] = dirOf(m.a); const rest = s - acc; return [px - dx * rest, py - dy * rest, m.a];
  }
  const trailers = (m) => Math.max(0, m.lv - 1);

  function step(S, inp) {
    const t = S.t + DT; S.t = t; S.steps++;
    if (S.ev.length > 220) S.ev.splice(0, S.ev.length - 220);
    if (S.freeze > 0) { S.freeze -= DT; return S; }
    const p = S.p;
    if (inp.adv) S.dw = (S.dw || 0) + 1;                                       // demo planner reached its mow waypoint
    // ---- input → joystick: drag from where the finger went down (portrait one-thumb control); arrows as a fallback ----
    let jx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), jy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (inp.press && inp.px !== undefined) { if (!S.anc) S.anc = inp.ax !== undefined ? [inp.ax, inp.ay] : [inp.px, inp.py]; jx = (inp.px - S.anc[0]) / K.JOY; jy = (inp.py - S.anc[1]) / K.JOY; }
    else S.anc = null;
    const active = Math.hypot(jx, jy) > 0.15;
    if (active) { S.lastIn = t; if (S.firstIn < 0) S.firstIn = t; }
    if (S.end >= 0) { jx = jy = 0; }

    drive(S, p, jx, jy, K.SPD);
    if (S.end < 0) cutAround(S, p, 'p');

    // ---- upgrade pad: standing on it pours coins in; a full pad levels the machine up and re-arms with the next cost ----
    const onPad = Math.hypot(p.x - PAD.x, p.y - PAD.y) < PAD.r + 20, cost = K.PAD_COST[S.padLv];
    if (onPad && S.money < 1 && cost < 999 && S.end < 0 && t - (S.brokeT || -9) > 1.2 && p.v < 60) { S.brokeT = t; S.ev.push({ k: 'broke', t, x: PAD.x, y: PAD.y, need: cost - S.padPaid }); }
    if (onPad && S.money > 0 && cost < 999 && S.end < 0) {
      const pay = Math.min(S.money, cost - S.padPaid, Math.max(1, Math.round(cost * K.PAD_RATE * DT * 100) / 100));
      const before = Math.floor(S.padPaid / 5); S.money -= pay; S.padPaid += pay;
      if (Math.floor(S.padPaid / 5) !== before) S.ev.push({ k: 'pay', t, x: p.x, y: p.y });
      if (S.padPaid >= cost - 1e-6) { S.padPaid = 0; S.padLv++; p.lv++; S.upT = t; S.freeze = 0.08;
        S.ev.push({ k: 'upgrade', t, x: PAD.x, y: PAD.y, lv: p.lv }); }
    }

    // ---- the rival: appears after a few seconds of play, mows its own path, drifts toward the player ----
    if (!S.rv && S.firstIn >= 0 && (t - S.firstIn > K.RIVAL_AT || (p.lv >= 2 && t - S.upT > 0.8))) {
      const sx = p.x < WORLD.x1 / 2 ? p.x + 760 : p.x - 760, sy = Math.max(400, p.y - 700);
      S.rv = machine(sx, sy, Math.atan2(p.x - sx, -(p.y - sy)), K.RIVAL_LV); S.rv.t0 = t; S.ev.push({ k: 'rival', t, x: sx, y: sy });
    }
    const r = S.rv;
    if (r && r.alive) {
      // it circles the player at a respectful distance, mowing its own ring: close enough to read, never glued to you
      const oa = Math.atan2(r.x - p.x, -(r.y - p.y)) + 0.6, tx = p.x + Math.sin(oa) * 430, ty = p.y - Math.cos(oa) * 430, d = Math.hypot(tx - r.x, ty - r.y) || 1;
      drive(S, r, (tx - r.x) / d, (ty - r.y) / d, K.RIVAL_SPD * ss(0, 1.2, t - r.t0));
      cutAround(S, r, 'r');
      const dd = Math.hypot(p.x - r.x, p.y - r.y);
      if (dd < K.HIT_R && S.end < 0) {
        if (p.lv > r.lv) { r.alive = false; r.deadT = t; S.freeze = 0.16; S.money += K.SMASH_BONUS; S.earned += K.SMASH_BONUS; p.lv++; S.winT = t;
          S.ev.push({ k: 'smash', t, x: (p.x + r.x) / 2, y: (p.y + r.y) / 2, rx: r.x, ry: r.y, lv: p.lv }); }
        else if (t - p.bumpT > 0.5) { const nx = (p.x - r.x) / (dd || 1), ny = (p.y - r.y) / (dd || 1);
          p.x += nx * 70; p.y += ny * 70; p.v = -80; r.v = -60; p.bumpT = t; S.freeze = 0.06;
          S.ev.push({ k: 'bump', t, x: (p.x + r.x) / 2, y: (p.y + r.y) / 2 }); }
      }
    }
    // ---- endcard: after the win, or when the time box runs out ----
    const why = S.winT > 0 && t - S.winT > K.END_AFTER_WIN ? 'win' : S.firstIn >= 0 && t - S.firstIn > K.END_MAX ? 'time'
      : S.firstIn < 0 && t > K.END_NO_INPUT ? 'time' : S.firstIn >= 0 && t - S.lastIn > K.END_IDLE ? 'time' : '';
    if (S.end < 0 && why) { S.end = t; S.endWhy = why; S.ev.push({ k: 'end', t, x: p.x, y: p.y }); }

    // ---- camera: follow with look-ahead, zoom out as the train grows, clamped to the world ----
    S.zoom += ((p.lv >= 3 ? 1.2 : p.lv === 2 ? 1.32 : 1.45) - S.zoom) * Math.min(1, 1.5 * DT);
    const [dx, dy] = dirOf(p.a), hw = VIEW.W / 2 / S.zoom, hh = VIEW.H / 2 / S.zoom;
    const tgx = Math.max(WORLD.x0 + hw, Math.min(WORLD.x1 - hw, p.x + dx * p.v * 0.35));
    const tgy = Math.max(WORLD.y0 + hh, Math.min(WORLD.y1 - hh, p.y + dy * p.v * 0.45 - 120));
    S.camV[0] += (24 * (tgx - S.cam[0]) - 9.8 * S.camV[0]) * DT; S.cam[0] += S.camV[0] * DT;
    S.camV[1] += (24 * (tgy - S.cam[1]) - 9.8 * S.camV[1]) * DT; S.cam[1] += S.camV[1] * DT;
    return S;
  }

  // ---- attract demo: a planner that plays the ad like a good player, expressed as a finger drag (the scene draws the hand) ----
  const MOW = [[580, 2450], [980, 2250], [1240, 2650], [900, 2950], [420, 2700], [300, 2250], [700, 2000]];
  const DEMO_ANC = [540, 1540];
  const scriptInput = (t, S) => {
    const p = S.p, inp = { left: 0, right: 0, up: 0, down: 0, jump: 0, act: 0, press: 0, px: DEMO_ANC[0], py: DEMO_ANC[1], ax: DEMO_ANC[0], ay: DEMO_ANC[1] };
    if (t < 0.6 || S.end >= 0) return inp;                                    // a beat of stillness: the hand appears first
    let tx, ty;
    const cost = K.PAD_COST[S.padLv];
    if (S.rv && S.rv.alive && p.lv > S.rv.lv) { tx = S.rv.x; ty = S.rv.y; }
    else if (S.rv && S.rv.alive && Math.hypot(S.rv.x - p.x, S.rv.y - p.y) < 300) { tx = 2 * p.x - S.rv.x; ty = 2 * p.y - S.rv.y; }   // too weak: steer clear
    else if (S.money >= cost - S.padPaid && cost < 999) { tx = PAD.x; ty = PAD.y; }
    else { const w = MOW[(S.dw || 0) % MOW.length]; if (Math.hypot(w[0] - p.x, w[1] - p.y) < 90) inp.adv = 1; tx = w[0]; ty = w[1]; }
    const d = Math.hypot(tx - p.x, ty - p.y) || 1, k = Math.min(1, d / 60);
    inp.press = 1; inp.px = DEMO_ANC[0] + (tx - p.x) / d * K.JOY * k; inp.py = DEMO_ANC[1] + (ty - p.y) / d * K.JOY * k;
    return inp;
  };
  let cache = null;
  function at(t) {
    const loop = Math.floor(t / L), q = t - loop * L, n = Math.round(q / DT);
    if (!cache || cache.loop !== loop || cache.S.steps > n) { const S0 = Object.assign(create(), { wt0: loop * L }); cache = { loop, S: S0 }; }
    const S = cache.S; while (S.steps < n) step(S, scriptInput(S.t, S));
    return Object.assign({}, S, { loop, q, demo: true, inp: scriptInput(S.t, S) });
  }
  // the demo must hit every beat of the ad inside its loop
  const demoCheck = (S) => { const k = (n) => S.ev.some((e) => e.k === n);
    const fails = []; if (S.p.lv < 3) fails.push('never reached level 3'); if (!S.rv) fails.push('rival never came');
    if (!(S.winT > 0)) fails.push('rival never smashed'); if (S.end < 0 || S.end > L - 3) fails.push('endcard late: ' + S.end.toFixed(1));
    void k; return fails; };

  root.SIM = { DT, L, K, VIEW, WORLD, HINT, SP, NX, NY, TREES, BASE, PAD, START, DEMO_ANC, create, spawn, respawn, outOfPlay, step, at,
    scriptInput, demoCheck, alongTrail, trailers, dirOf, treeAt };
  if (typeof module !== 'undefined') module.exports = root.SIM;
})(typeof window !== 'undefined' ? window : globalThis);
