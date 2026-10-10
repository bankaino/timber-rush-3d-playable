// live/hud.js — TIMBER RUSH HUD on the Canvas2D overlay (view px, VW×VH). GENERIC blocks to keep in every playable:
// money pill + coins flying to it, level badges, pad price, guide arrow + edge marker, callouts, tutorial hand + banner,
// joystick ring, persistent CTA bar, endcard (headline by endWhy, stat, big CTA, replay, whole screen = CTA).
// HUD.hit = tappable rects (index.html: 'cta' → store, 'replay'); HUD.check() = QA (boxes off-screen / overlapping).
(function () {
  const H = KIT.H, HUD = (window.HUD = { hit: [] });
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), ease = (x) => 1 - (1 - x) * (1 - x), SS = (a, b, x) => { const q = clamp((x - a) / (b - a), 0, 1); return q * q * (3 - 2 * q); };
  const DARK = [0.06, 0.11, 0.05], DARK2 = [0.03, 0.06, 0.02];
  const coin = (x, y, s) => { if (H.img.coin) H.sprite('coin', x - s / 2, y - s / 2, s, s); else { const c = H.ctx; c.fillStyle = '#ffd23a'; c.beginPath(); c.arc(x, y, s / 2, 0, 7); c.fill(); } };

  HUD.draw = (ST, t, proj) => {
    const TITLE = ((window.BUILD || {}).title || 'TIMBER RUSH').toUpperCase();   // BUILD arrives after the modules in dev
    const W = H.W, Hh = H.Hh, GT = ST.t, p = ST.p, rv = ST.rv, K = SIM.K, PAD = SIM.PAD, c = H.ctx;
    H.begin(); const hit = [];
    const cost = K.PAD_COST[ST.padLv], left = Math.max(0, cost - ST.padPaid);
    // ---- coins flying from each felled tree to the money pill ----
    const mtw = Math.max(H.labelW(String(Math.max(0, Math.round(ST.money))), 66), 60), mpw = 96 + 26 + mtw + 44, mpx = W / 2 - mpw / 2, hc = [mpx + 52, 118];
    let inFlight = 0;
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0) continue;
      if (e.k === 'cut' && e.coin && a < 0.7) { inFlight += K.TREE_VAL; const s0 = proj(e.x, e.y, 1.1); if (!s0) continue;
        let x, y, s; if (a < 0.18) { const q = a / 0.18; x = s0[0]; y = s0[1] - 60 * Math.sin(q * Math.PI / 2); s = 30 + 22 * q; }
        else { const q = Math.pow((a - 0.18) / 0.52, 1.6); x = s0[0] + (hc[0] - s0[0]) * q; y = s0[1] - 60 + (hc[1] - s0[1] + 60) * q; s = 52 - 14 * q; }
        coin(x, y, s); }
      if (e.k === 'smash' && a < 1.2) { inFlight += K.SMASH_BONUS * (1 - clamp(a / 1.2, 0, 1)); const s0 = proj(e.rx, e.ry, 1); if (!s0) continue;
        for (let j = 0; j < 14; j++) { const qj = clamp((a - j * 0.04) / 0.8, 0, 1); if (qj <= 0 || qj >= 1) continue; const ox = s0[0] + Math.cos(j * 2.4) * 120, oy = s0[1] + Math.sin(j * 2.4) * 80, u = Math.pow(qj, 1.5);
          coin(ox + (hc[0] - ox) * u, oy + (hc[1] - oy) * u - 160 * Math.sin(Math.PI * qj), 56); } } }
    // ---- money pill (sized to its content), bumps when a coin lands ----
    let bump = 0; for (const e of ST.ev) { const a = GT - e.t - 0.7; if (e.k === 'cut' && e.coin && a >= 0 && a < 0.12) bump = Math.max(bump, 1 - a / 0.12); }
    H.pill(mpx, 70, mpw, 96, 48, DARK, DARK2, 0.78, 'money'); coin(hc[0], hc[1], 96 * (1 + 0.08 * bump));
    H.label(String(Math.max(0, Math.round(ST.money - inFlight))), mpx + 96 + 26, 118, { size: 66, col: '#ffe066', out: '#3a2300' });
    // ---- level badges over the cabs ----
    const badges = [];
    for (const [m, red] of [[p, false], [rv, true]]) { if (!m || !m.alive || ST.end >= 0) continue; const s0 = proj(m.x, m.y, 2.5); if (s0) badges.push([s0[0], s0[1], m.lv, red]); }
    if (badges.length === 2 && Math.abs(badges[0][0] - badges[1][0]) < 170 && Math.abs(badges[0][1] - badges[1][1]) < 64) badges[1][1] = badges[0][1] - 66;
    for (const [bx, by, lv, red] of badges) { if (bx < 90 || bx > W - 90 || by < 200 || by > Hh - 220) continue;
      const txt = 'LV ' + lv + (red ? (p.lv > lv ? '  CRUSH IT!' : '  TOO STRONG') : ''), bw = H.labelW(txt, 34) + 34;
      H.pill(bx - bw / 2, by - 27, bw, 54, 27, red ? [0.92, 0.22, 0.18] : [0.24, 0.70, 0.18], red ? [0.70, 0.10, 0.08] : [0.12, 0.48, 0.10], 1, red ? 'lvr' : 'lvp');
      H.label(txt, bx, by, { size: 34, col: '#fff', out: '#1b2a0c', al: 0.5 }); }
    // ---- the pad's price, on the pad ----
    if (ST.end < 0 && cost < 999) { const s0 = proj(PAD.x, PAD.y, 0.2);
      if (s0 && s0[0] > 120 && s0[0] < W - 120 && s0[1] > 260 && s0[1] < Hh - 300) { const txt = String(Math.ceil(left)), w = H.labelW(txt, 52) + 80;
        H.pill(s0[0] - w / 2, s0[1] - 36, w, 72, 36, DARK, DARK2, 0.8, 'padc'); coin(s0[0] - w / 2 + 33, s0[1], 50);
        H.label(txt, s0[0] - w / 2 + 66, s0[1], { size: 52, col: '#ffe066', out: '#3a2300' });
        H.label('+1 LEVEL', s0[0], s0[1] - 76, { size: 40, col: '#fff', out: '#173307', al: 0.5, id: 'padt' }); } }
    // ---- guide arrow toward the current goal (pad when affordable, the rival once you out-level it) ----
    let goal = null, gcol = [1, 0.84, 0.2], gtxt = '';
    if (ST.end < 0 && rv && rv.alive && p.lv > rv.lv) { goal = [rv.x, rv.y]; gcol = [1, 0.3, 0.2]; gtxt = 'CRUSH IT!'; }
    else if (ST.end < 0 && cost < 999 && ST.money >= left && Math.hypot(p.x - PAD.x, p.y - PAD.y) > PAD.r + 40) { goal = [PAD.x, PAD.y]; gtxt = 'UPGRADE!'; }
    const hs = proj(p.x, p.y, 0.4);
    if (goal && hs) { const gs = proj(goal[0], goal[1], 0.4) || [W / 2, -200], an = Math.atan2(gs[1] - hs[1], gs[0] - hs[0]), r = 230 + 12 * Math.sin(t * 8);
      const ax = hs[0] + Math.cos(an) * r, ay = hs[1] + Math.sin(an) * r;
      for (let j = 0; j < 3; j++) { const o = j * 52, x = ax + Math.cos(an) * o, y = ay + Math.sin(an) * o;
        c.save(); c.translate(x, y); c.rotate(an); c.globalAlpha = 1 - j * 0.25; c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); c.moveTo(-26, -34); c.lineTo(10, 0); c.lineTo(-26, 34); c.lineWidth = 30; c.strokeStyle = 'rgba(30,18,4,0.5)'; c.stroke(); c.lineWidth = 20; c.strokeStyle = H.rgba(gcol); c.stroke(); c.restore(); }
      const onScreen = gs[0] > 60 && gs[0] < W - 60 && gs[1] > 200 && gs[1] < Hh - 260;
      if (onScreen) H.glow(gs[0], gs[1], 140, gcol, 0.25 + 0.15 * Math.sin(t * 6));
      else { const ex = clamp(gs[0], 70, W - 70), ey = clamp(gs[1], 240, Hh - 260), pb = 1 + 0.12 * Math.sin(t * 8);
        H.pill(ex - 44 * pb, ey - 44 * pb, 88 * pb, 88 * pb, 44 * pb, gcol, gcol.map((v) => v * 0.65)); if (gtxt === 'UPGRADE!') coin(ex, ey, 60); else H.label('!', ex, ey, { size: 60, col: '#fff', out: '#7a0d06', al: 0.5 }); }
      const lx = clamp(ax + Math.cos(an) * 120, 170, W - 170), ly = clamp(ay + Math.sin(an) * 80 + (Math.abs(Math.cos(an)) > 0.7 ? 60 : 0), 230, Hh - 300);
      H.label(gtxt, lx, ly, { size: 46, col: '#fff', out: gcol[1] < 0.5 ? '#7a0d06' : '#6b4a00', al: 0.5 }); }
    // ---- floating callouts from events ----
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0) continue;
      const pop = (txt, x, y, life, size, col, out) => { if (a > life) return; const q = a / life, s = size * (a < 0.12 ? 0.6 + 0.4 * a / 0.12 : 1);
        H.label(txt, x, y - 90 * ease(q), { size: Math.round(s), col, out, al: 0.5, a: 1 - SS(0.7, 1, q) }); };
      if (e.k === 'upgrade') pop('LEVEL UP!', W / 2, Hh * 0.36, 1.3, 96, '#fff27a', '#5a3a00');
      if (e.k === 'bump') pop('TOO WEAK! UPGRADE', W / 2, Hh * 0.36, 1.1, 64, '#ffffff', '#8a1208');
      if (e.k === 'smash') pop('CRUSHED! +' + K.SMASH_BONUS, W / 2, Hh * 0.44, 1.5, 100, '#fff27a', '#7a1a00');
      if (e.k === 'broke') pop('NEED ' + Math.ceil(e.need) + ' COINS', W / 2, Hh * 0.40, 1.1, 60, '#ffffff', '#6b4a00');
      if (e.k === 'rival') pop('RIVAL INVADES!', W / 2, 300, 1.8, 72, '#ff6a50', '#3a0400'); }
    // ---- tutorial: the hand shows the drag (demo: the scripted finger; play: before the first drag or after 2.5 s idle) ----
    const idle = ST.end < 0 && (ST.demo ? GT < 2.6 : (ST.firstIn < 0 || GT - ST.lastIn > 2.5));
    if (ST.end < 0 && (ST.demo || idle)) {
      let hx, hy, down;
      if (ST.demo && ST.inp && ST.inp.press) { hx = ST.inp.px; hy = ST.inp.py; down = 1; }
      else { const q = (t * 0.8) % 1, u = SS(0.15, 0.75, q); hx = SIM.DEMO_ANC[0] + 150 * Math.sin(u * 3.2); hy = SIM.DEMO_ANC[1] - 130 * u; down = q > 0.1 && q < 0.85; }
      if (down) H.glow(hx, hy, 70, [1, 1, 1], 0.35);
      const hh = 190 * (down ? 0.92 : 1); if (H.img.hand) H.sprite('hand', hx - hh * 0.54 * 0.33, hy - hh * 0.03, hh * 0.54, hh); else H.ring(hx, hy, 40, [1, 1, 1], 0.9, 14);
      if ((idle && ST.firstIn < 0) || (ST.demo && GT < 2.6)) { const b = 1 + 0.04 * Math.sin(t * 6), sz = Math.round(70 * b), tw = H.labelW('DRAG TO CUT TREES!', sz);
        H.pill(W / 2 - tw / 2 - 40, 330 - 62, tw + 80, 124, 62, [0.05, 0.10, 0.04], [0.02, 0.05, 0.02], 0.7, 'tut');
        H.label('DRAG TO CUT TREES!', W / 2, 330, { size: sz, col: '#fff', out: '#173307', al: 0.5 }); }
    }
    if (!ST.demo && ST.anc && ST.end < 0) { H.ring(ST.anc[0], ST.anc[1], 90, [1, 1, 1], 0.35, 8); H.glow(ST.anc[0], ST.anc[1], 40, [1, 1, 1], 0.2); }
    // ---- persistent CTA bar (store button visible the whole time) ----
    if (ST.end < 0) { const bw = 330, bh = 104, bx = W - bw - 36, by = Hh - bh - 44, pul = 1 + 0.03 * Math.sin(t * 5);
      H.pill(24, by - 18, W - 48, bh + 36, 30, DARK, DARK2, 0.72);
      H.label(TITLE, 70, by + bh / 2, { size: 50, col: '#ffd84a', out: '#2a1a00', id: 'brand' });
      H.pill(bx - (pul - 1) * bw / 2, by - (pul - 1) * bh / 2, bw * pul, bh * pul, bh / 2, [0.35, 0.68, 1.0], [0.10, 0.42, 0.95], 1, 'cta');
      H.label('PLAY NOW', bx + bw / 2, by + bh / 2, { size: 50, col: '#fff', out: '#0a2a70', al: 0.5 });
      hit.push({ id: 'cta', x: bx, y: by, w: bw, h: bh }); }
    // ---- endcard (the world is dimmed and the worker drawn in 3D by scene.js; text and buttons here) ----
    if (ST.end >= 0) { const oy = (Hh - 1920) / 2, a = GT - ST.end, k = SS(0, 0.45, a), pop = (d) => { const q = clamp((a - d) / 0.35, 0, 1); return q < 1 ? 1.12 * ease(q) - 0.12 * q * q : 1; };
      const s1 = pop(0.2); if (s1 > 0.01) { H.label(ST.endWhy === 'win' ? 'RIVAL CRUSHED!' : 'YOUR FOREST AWAITS!', W / 2, 220 + oy, { size: Math.round(64 * s1), col: '#fff', out: '#173307', al: 0.5, id: 'head' });
        H.label(TITLE, W / 2, 340 + oy, { size: Math.round(124 * s1), col: '#ffd84a', out: '#3a2000', al: 0.5, id: 'logo' });
        H.label('Build your timber empire!', W / 2, 460 + oy, { size: 56, col: '#fff', out: '#173307', al: 0.5, a: k, id: 'tag' }); }
      const s2 = pop(0.45); if (s2 > 0.01) H.label((ST.felled || 0) + ' TREES CUT · LV ' + p.lv, W / 2, 1150 + oy, { size: Math.round(54 * s2), col: '#bff58a', out: '#173307', al: 0.5, id: 'stat' });
      const s3 = pop(0.7), pul = 1 + 0.045 * Math.sin(t * 6), bw = 640 * s3 * pul, bh = 170 * s3 * pul, bx = W / 2 - bw / 2, by = 1350 + oy - bh / 2;
      if (s3 > 0.01) { H.glow(W / 2, 1350 + oy, 420, [1, 0.8, 0.3], 0.3);
        H.pill(bx, by + 12, bw, bh, bh / 2, [0.55, 0.30, 0.02], [0.45, 0.22, 0.0]); H.pill(bx, by, bw, bh, bh / 2, [1.0, 0.86, 0.30], [0.98, 0.58, 0.10], 1, 'endcta');
        H.label('PLAY NOW', W / 2, by + bh / 2, { size: Math.round(86 * s3), col: '#fff', out: '#7a3a00', al: 0.5 });
        hit.push({ id: 'cta', x: bx, y: by, w: bw, h: bh }); }
      if (a > 1.2) { H.label('↻ REPLAY', W / 2, 1580 + oy, { size: 46, col: '#fff', out: '#173307', al: 0.5, a: SS(1.2, 1.6, a), id: 'replay' });
        hit.unshift({ id: 'replay', x: W / 2 - 170, y: 1540 + oy, w: 340, h: 80 }); }
      if (a > 0.6) hit.push({ id: 'cta', x: 0, y: 0, w: W, h: Hh }); }
    HUD.hit = hit;
  };
  // QA: pills and labels that leave the screen or overlap (badges may overlap the world; the CTA bar holds brand + button)
  HUD.check = () => H.check(['brand', 'cta']);
})();
