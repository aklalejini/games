'use strict';
/* ============================================================
   STONEBROOK — a tiny pixel-art city builder
   All art is generated procedurally on <canvas> at boot.
   ============================================================ */

// ---------- constants ----------
const TILE = 16, COLS = 40, ROWS = 26;
const W = COLS * TILE, H = ROWS * TILE;
const DAY_LEN = 60;            // real seconds per in-game day at 1x speed
const SAVE_KEY = 'stonebrook-save-v1';

// ---------- palette (sampled from the reference style) ----------
const C = {
  roof: '#b04a26', roofL: '#d4703f', roofD: '#7c2f16', roofHi: '#e2885a', ridge: '#8e3a1d', eave: '#5e2310',
  stone: '#8b8b93', stoneL: '#a8a8b0', stoneD: '#65656d', mortar: '#5a5a62',
  wood: '#6b4528', woodL: '#8a6038', woodD: '#42291a', plank: '#c9a06a',
  ground: '#d7c6a2', groundL: '#e3d5b5', groundD: '#c2ae88', grout: '#b3a07d',
  grass: '#5d9747', grassL: '#7fbe5f', grassD: '#456f33',
  leafD: '#2e5b25', leaf: '#4a8736', leafL: '#6fb050', leafHi: '#9ad26d',
  fR: '#c13a30', fR2: '#e25b48', fP: '#d9799f', fP2: '#eda3bf', fO: '#de8c3a', fOL: '#f2b066',
  fY: '#e7c84f', fW: '#efe6d6',
  soil: '#7a5b39', soilD: '#5f452a',
  glass: '#46435a', glassL: '#6e6a8a',
  plaster: '#d8c7a8', plasterD: '#bfa988',
  shadow: 'rgba(35,25,15,0.30)',
};
const RES_COLORS = { gold: '#f3cd4e', wood: '#c08a52', stone: '#bcbcc6', food: '#94d45a' };

// ---------- utils ----------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
function mkc(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}
const px = g => (x, y, col, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x | 0, y | 0, w, h); };

// ---------- shared paint helpers ----------
function paintRoof(p, R, x, y, w, h) {
  for (let ry = 0; ry < h; ry += 3) {
    const hh = Math.min(3, h - ry);
    p(x, y + ry, C.roof, w, hh);
    const off = ((ry / 3) | 0) % 2 ? 2 : 0;
    for (let rx = off; rx < w; rx += 4) {
      const r = R(), cw = Math.min(3, w - rx);
      if (r < 0.20) p(x + rx, y + ry, C.roofL, cw, Math.max(1, hh - 1));
      else if (r < 0.32) p(x + rx, y + ry, C.roofD, cw, Math.max(1, hh - 1));
      if (rx > 0) p(x + rx - 1, y + ry, C.roofD, 1, hh);
    }
    if (hh === 3) p(x, y + ry + 2, C.roofD, w, 1);
  }
  p(x, y, C.ridge, w, 2);
  for (let rx = 2; rx < w - 1; rx += 4) p(x + rx, y, C.roofHi, 2, 1);
  p(x, y + h - 1, C.eave, w, 1);
}
function paintWall(p, R, x, y, w, h) {
  p(x, y, C.mortar, w, h);
  for (let ry = 0; ry < h; ry += 3) {
    const off = ((ry / 3) | 0) % 2 ? 3 : 0;
    for (let rx = -3 + off; rx < w; rx += 6) {
      const bx = Math.max(rx, 0), bw = Math.min(rx + 5, w) - bx;
      if (bw <= 0) continue;
      const r = R();
      p(x + bx, y + ry, r < 0.16 ? C.stoneL : r < 0.32 ? C.stoneD : C.stone, bw, Math.min(2, h - ry));
    }
  }
}
function paintDoor(p, x, y, w, h) {
  p(x - 1, y - 1, C.woodD, w + 2, h + 1);
  p(x, y, C.wood, w, h);
  for (let i = x + 1; i < x + w; i += 2) p(i, y, C.woodD, 1, h);
  p(x, y, C.woodL, w, 1);
  p(x + w - 2, y + (h >> 1), C.fY, 1, 1);
}
function paintWindow(p, R, x, y) {
  p(x - 1, y - 1, C.woodD, 6, 6);
  p(x, y, C.glass, 4, 4);
  p(x, y, C.glassL, 4, 1);
  p(x + 2, y, C.woodD, 1, 4);
}
function paintFlowerBox(p, R, x, y, w) {
  p(x, y, C.woodD, w, 2);
  p(x, y + 1, C.wood, w, 1);
  const cols = [C.fR, C.fP, C.fO, C.fY, C.fW];
  for (let i = 0; i < w; i += 2) {
    p(x + i, y - 1, cols[(R() * cols.length) | 0], 1, 1);
    if (R() < 0.55) p(x + i + 1, y - 1, C.leafL, 1, 1);
  }
}
function paintBush(p, R, x, y, w, h, flower) {
  p(x, y, C.leaf, w, h);
  p(x, y, C.leafL, w, 1);
  for (let i = 0; i < w * h * 0.3; i++) p(x + R() * w, y + R() * h, R() < 0.5 ? C.leafD : C.leafHi);
  if (flower) for (let i = 0; i < 3; i++) p(x + 1 + R() * (w - 2), y + R() * (h - 1), flower);
}

// ---------- terrain sprites ----------
function spriteGround(R, variant) {
  const [c, g] = mkc(TILE, TILE); const p = px(g);
  p(0, 0, C.ground, 16, 16);
  p(0, 7, C.grout, 16, 1); p(0, 15, C.grout, 16, 1);
  p(3 + ((R() * 9) | 0), 0, C.grout, 1, 7);
  p(3 + ((R() * 9) | 0), 8, C.grout, 1, 7);
  for (let i = 0; i < 14; i++) p((R() * 16) | 0, (R() * 16) | 0, R() < 0.5 ? C.groundL : C.groundD);
  if (R() < 0.4) p((R() * 12) | 0, (R() * 12) | 0, C.groundD, 2, 1);
  if (variant >= 5) { // mossy / overgrown variants
    const mx = (R() * 10) | 0, my = (R() * 10) | 0;
    p(mx, my, C.grassD, 4, 3); p(mx + 1, my - 1, C.grass, 3, 2); p(mx + 2, my + 1, C.grassL, 2, 1);
    for (let i = 0; i < 5; i++) p((R() * 16) | 0, (R() * 16) | 0, C.grass, 1, 2);
    if (R() < 0.5) p((R() * 14) | 0, (R() * 14) | 0, R() < 0.5 ? C.fY : C.fW);
  } else if (R() < 0.35) {
    p((R() * 14) | 0, (R() * 14) | 0, C.grass, 1, 2);
  }
  return c;
}
function spriteGrass(R) {
  const [c, g] = mkc(TILE, TILE); const p = px(g);
  p(0, 0, C.grass, 16, 16);
  for (let i = 0; i < 12; i++) p((R() * 16) | 0, (R() * 16) | 0, C.grassD);
  for (let i = 0; i < 9; i++) p((R() * 16) | 0, (R() * 16) | 0, C.grassL);
  for (let i = 0; i < 3; i++) p((R() * 15) | 0, (R() * 14) | 0, C.grassL, 1, 2);
  if (R() < 0.4) { const f = [C.fW, C.fY, C.fP][(R() * 3) | 0]; p((R() * 14) | 0, (R() * 14) | 0, f); }
  return c;
}
function spriteTree(R, flower) {
  const [c, g] = mkc(TILE, TILE); const p = px(g);
  p(2, 13, C.shadow, 12, 3);
  // dark silhouette, then inner fill, for a rounded outlined dome
  const rows = [[5, 6], [3, 10], [1, 14], [0, 16], [0, 16], [1, 14], [2, 12], [4, 8]];
  let y = 0;
  for (const [x, w] of rows) { p(x, y, C.leafD, w, 2); y += 2; }
  y = 1;
  for (const [x, w] of [[6, 4], [4, 8], [2, 12], [1, 14], [1, 14], [2, 12], [4, 8]]) { p(x, y, C.leaf, w, 2); y += 2; }
  // shading: light upper-left, dark lower-right
  p(5, 1, C.leafL, 5, 2); p(3, 3, C.leafL, 6, 2); p(2, 5, C.leafL, 4, 2);
  for (let i = 0; i < 7; i++) p(3 + R() * 8, 1 + R() * 6, C.leafHi);
  for (let i = 0; i < 9; i++) p(5 + R() * 9, 7 + R() * 6, C.leafD);
  for (let i = 0; i < 5; i++) p(2 + R() * 11, 3 + R() * 8, C.leafL);
  if (flower) {
    for (let i = 0; i < 6; i++) {
      const fx = 2 + R() * 11, fy = 2 + R() * 10;
      p(fx, fy, flower[0]); if (R() < 0.7) p(fx + 1, fy, flower[1]);
    }
  }
  return c;
}
function spriteRock(R) {
  const [c, g] = mkc(TILE, TILE); const p = px(g);
  p(2, 12, C.shadow, 12, 2);
  const rows = [[5, 6], [3, 10], [2, 12], [2, 12], [3, 10]];
  let y = 4;
  for (const [x, w] of rows) { p(x, y, C.stone, w, 2); y += 2; }
  p(4, 4, C.stoneL, 6, 2); p(3, 6, C.stoneL, 4, 1);
  p(3, 11, C.stoneD, 10, 2); p(8, 7, C.stoneD, 1, 4); p(5, 8, C.stoneD, 2, 1);
  p(12, 9, C.stone, 3, 4); p(12, 9, C.stoneL, 2, 1);
  if (R() < 0.6) p(1, 13, C.stoneD, 2, 1);
  return c;
}
function spritePath(R) {
  const [c, g] = mkc(TILE, TILE); const p = px(g);
  p(0, 0, '#cdc3b2', 16, 16);
  p(0, 0, '#a99e8a', 16, 1); p(0, 0, '#a99e8a', 1, 16);
  p(0, 15, '#a99e8a', 16, 1); p(15, 0, '#a99e8a', 1, 16);
  p(1, 7, '#b3a892', 14, 1); p(7, 1, '#b3a892', 1, 6); p(11, 8, '#b3a892', 1, 7);
  p(1, 1, '#ddd4c2', 6, 1); p(1, 8, '#d6ccba', 5, 1);
  for (let i = 0; i < 6; i++) p(1 + R() * 14, 1 + R() * 14, R() < 0.5 ? '#ddd4c2' : '#bfb4a0');
  return c;
}

// ---------- building sprites ----------
function spriteCottage(R) {
  const [c, g] = mkc(32, 32); const p = px(g);
  p(1, 29, C.shadow, 30, 3);
  paintWall(p, R, 2, 17, 28, 13);
  paintRoof(p, R, 0, 3, 32, 14);
  p(24, 0, C.stoneD, 4, 4); p(24, 0, C.stoneL, 4, 1); // chimney
  paintDoor(p, 13, 20, 6, 10);
  paintWindow(p, R, 6, 21); paintFlowerBox(p, R, 5, 26, 6);
  paintWindow(p, R, 23, 21); paintFlowerBox(p, R, 22, 26, 6);
  return c;
}
function spriteFarm(R) {
  const [c, g] = mkc(48, 48); const p = px(g);
  // tilled field
  p(1, 1, C.soil, 46, 46);
  for (let x = 3; x < 46; x += 5) {
    p(x, 2, C.soilD, 2, 44);
    for (let y = 4; y < 44; y += 3) {
      const r = R();
      if (r < 0.8) { p(x, y, C.leaf, 2, 2); p(x, y, C.leafL, 1, 1); }
      else if (r < 0.9) { p(x, y, C.fO, 2, 2); p(x, y, C.fOL, 1, 1); }
    }
  }
  // fence
  for (let x = 0; x < 48; x += 8) { p(x, 0, C.woodD, 2, 4); p(x, 44, C.woodD, 2, 4); }
  p(0, 1, C.wood, 48, 1); p(0, 45, C.wood, 48, 1);
  for (let y = 8; y < 44; y += 8) { p(0, y, C.woodD, 2, 4); p(46, y, C.woodD, 2, 4); }
  // scarecrow
  p(23, 14, C.woodD, 1, 10); p(20, 16, C.wood, 7, 1);
  p(22, 12, C.fY, 3, 3); p(22, 12, '#caa83a', 3, 1);
  return c;
}
function spriteLumber(R) {
  const [c, g] = mkc(32, 32); const p = px(g);
  p(1, 29, C.shadow, 30, 3);
  // plank pile (top)
  p(6, 6, C.plank, 16, 2); p(7, 9, C.plank, 14, 2); p(6, 12, C.plank, 16, 2);
  p(6, 7, C.woodL, 16, 1); p(7, 10, C.woodL, 14, 1); p(6, 13, C.woodL, 16, 1);
  // log pile (bottom-left): two logs + one on top
  const log = (x, y, len) => {
    p(x, y, C.wood, len, 4); p(x, y, C.woodL, len, 1); p(x, y + 3, C.woodD, len, 1);
    p(x + len, y, C.plank, 3, 4); p(x + len + 1, y + 1, C.wood, 1, 2);
  };
  log(2, 25, 14); log(2, 20, 14); log(5, 16, 12);
  // stump with axe (right)
  p(22, 23, C.shadow, 9, 2);
  p(22, 19, C.woodL, 8, 6); p(23, 20, C.plank, 6, 4); p(25, 21, C.wood, 2, 2);
  p(26, 13, C.woodD, 1, 7); p(25, 12, C.stoneL, 4, 2); p(25, 12, C.stoneD, 4, 1);
  return c;
}
function spriteQuarry(R) {
  const [c, g] = mkc(32, 32); const p = px(g);
  // pit with stepped rim
  p(1, 2, C.stone, 30, 28);
  p(1, 2, C.stoneL, 30, 2); p(1, 2, C.stoneL, 2, 28); p(29, 2, C.stoneD, 2, 28); p(1, 28, C.stoneD, 30, 2);
  p(4, 5, '#5a5a62', 24, 22);
  p(6, 7, '#4a4a52', 20, 18);
  p(4, 5, '#73737b', 24, 1); p(6, 7, '#62626a', 20, 1);
  // cut blocks
  const block = (x, y) => {
    p(x, y, C.stoneL, 6, 5); p(x, y, '#c4c4cc', 6, 1);
    p(x + 5, y, C.stoneD, 1, 5); p(x, y + 4, C.stoneD, 6, 1);
  };
  block(8, 10); block(16, 14); block(9, 19);
  // ladder
  p(25, 6, C.woodD, 1, 18); p(28, 6, C.woodD, 1, 18);
  for (let y = 8; y < 23; y += 3) p(25, y, C.wood, 4, 1);
  // rubble
  for (let i = 0; i < 8; i++) p(6 + R() * 16, 8 + R() * 16, R() < 0.5 ? C.stone : C.stoneD);
  return c;
}
function spriteWell(R) {
  const [c, g] = mkc(16, 16); const p = px(g);
  p(3, 13, C.shadow, 11, 2);
  // posts + little roof
  p(3, 2, C.woodD, 1, 8); p(12, 2, C.woodD, 1, 8);
  p(2, 0, C.roof, 12, 2); p(2, 0, C.roofL, 12, 1); p(2, 2, C.roofD, 12, 1);
  // rope + bucket
  p(8, 3, '#d8cba6', 1, 4); p(7, 7, C.wood, 3, 2); p(7, 7, C.woodL, 3, 1);
  // stone ring
  p(4, 9, C.stone, 8, 2); p(3, 11, C.stone, 10, 2); p(4, 13, C.stoneD, 8, 1);
  p(4, 9, C.stoneL, 8, 1); p(6, 10, '#23232b', 4, 2);
  p(5, 11, C.stoneD, 1, 1); p(10, 12, C.stoneD, 2, 1);
  return c;
}
function spriteGarden(R) {
  const [c, g] = mkc(16, 16); const p = px(g);
  p(1, 1, C.woodD, 14, 14);
  p(2, 2, C.soilD, 12, 12);
  const cols = [C.fR, C.fY, C.fP, C.fW, C.fO];
  for (let y = 3; y < 13; y += 3) for (let x = 3; x < 13; x += 3) {
    p(x, y, cols[(R() * cols.length) | 0]);
    if (R() < 0.7) p(x + 1, y + 1, C.leaf);
  }
  p(1, 1, C.wood, 14, 1);
  return c;
}
function spriteBakery(R) {
  const [c, g] = mkc(32, 32); const p = px(g);
  p(1, 29, C.shadow, 30, 3);
  // plaster wall with timber frame
  p(2, 17, C.plaster, 28, 13);
  for (let i = 0; i < 16; i++) p(3 + R() * 26, 18 + R() * 11, C.plasterD);
  p(2, 17, C.woodD, 28, 1); p(2, 17, C.woodD, 1, 13); p(29, 17, C.woodD, 1, 13);
  p(9, 17, C.woodD, 1, 13); p(22, 17, C.woodD, 1, 13);
  paintRoof(p, R, 0, 4, 32, 13);
  p(5, 0, C.stoneD, 4, 5); p(5, 0, C.stoneL, 4, 1); // chimney
  p(10, 1, '#cdc8bf', 2, 1); p(13, 0, '#bdb8af', 1, 1); // smoke puffs
  paintDoor(p, 13, 20, 6, 10);
  // awning over door
  p(11, 18, C.roofL, 10, 1); p(11, 19, C.fW, 10, 1);
  paintWindow(p, R, 24, 21); paintFlowerBox(p, R, 23, 26, 6);
  // hanging bread sign
  p(4, 19, C.woodD, 1, 3); p(3, 22, C.fY, 3, 2); p(3, 22, '#caa83a', 3, 1);
  return c;
}
function spriteMarket(R) {
  const [c, g] = mkc(48, 48); const p = px(g);
  p(2, 44, C.shadow, 44, 3);
  // stall: striped awning + counter with goods
  const stall = (x, stripe) => {
    for (let sx = 0; sx < 20; sx += 4) {
      p(x + sx, 2, stripe, 4, 9); p(x + sx + 2, 2, C.fW, 2, 9);
    }
    p(x, 2, '#00000000', 0, 0); g.fillStyle = 'rgba(60,25,10,0.35)'; g.fillRect(x, 9, 20, 2);
    p(x, 11, C.woodD, 20, 1);
    p(x, 12, C.woodD, 1, 10); p(x + 19, 12, C.woodD, 1, 10);
    p(x + 1, 14, C.wood, 18, 7); p(x + 1, 14, C.woodL, 18, 1);
    for (let i = 1; i < 18; i += 3) p(x + 1 + i, 15, C.woodD, 1, 6);
  };
  stall(2, C.roof); stall(26, C.leaf);
  // goods on counters
  const goods = (x, cols) => { for (let i = 0; i < 6; i++) p(x + (i % 3) * 3, 15 + ((i / 3) | 0) * 3, cols[i % cols.length], 2, 2); };
  goods(5, [C.fR, C.fY, C.fO]); goods(29, [C.fOL, C.fR2, C.fY]);
  // crates
  const crate = (x, y) => {
    p(x, y, C.plank, 9, 9); p(x, y, C.woodD, 9, 1); p(x, y + 8, C.woodD, 9, 1);
    p(x, y, C.woodD, 1, 9); p(x + 8, y, C.woodD, 1, 9);
    for (let i = 1; i < 8; i++) { p(x + i, y + i, C.woodL); p(x + 8 - i, y + i, C.woodL); }
  };
  crate(4, 31); crate(14, 33);
  // barrel (like the reference)
  p(31, 28, C.woodD, 10, 14); p(32, 28, C.wood, 8, 14);
  for (let i = 33; i < 40; i += 2) p(i, 28, C.woodD, 1, 14);
  p(31, 30, '#3a3a42', 10, 1); p(31, 38, '#3a3a42', 10, 1);
  p(32, 28, C.woodL, 8, 1);
  // sack
  p(25, 36, C.plasterD, 5, 6); p(26, 35, C.plaster, 3, 2); p(26, 34, C.woodD, 3, 1);
  return c;
}
function spriteManor(R) {
  const [c, g] = mkc(48, 48); const p = px(g);
  p(1, 45, C.shadow, 46, 3);
  paintWall(p, R, 2, 24, 44, 22);
  paintRoof(p, R, 0, 8, 48, 17);
  // upper tower + roof
  paintWall(p, R, 17, 4, 14, 5);
  paintRoof(p, R, 15, 0, 18, 6);
  p(22, 5, C.glass, 4, 3); p(22, 5, C.glassL, 4, 1);
  // grand door (arched)
  p(20, 30, C.woodD, 10, 16); p(21, 29, C.woodD, 8, 1);
  p(21, 31, C.wood, 8, 15); p(22, 30, C.wood, 6, 1);
  for (let i = 22; i < 29; i += 2) p(i, 31, C.woodD, 1, 15);
  p(21, 31, C.woodL, 8, 1); p(27, 38, C.fY, 1, 1);
  // windows with flower boxes
  paintWindow(p, R, 7, 28); paintFlowerBox(p, R, 6, 33, 6);
  paintWindow(p, R, 37, 28); paintFlowerBox(p, R, 36, 33, 6);
  paintWindow(p, R, 7, 38); paintWindow(p, R, 37, 38);
  // hedges at the base corners
  paintBush(p, R, 2, 41, 8, 5, C.fR);
  paintBush(p, R, 38, 41, 8, 5, C.fP);
  return c;
}

// ---------- resource icons ----------
function iconGold() {
  const [c, g] = mkc(10, 10); const p = px(g);
  p(2, 1, C.fY, 6, 8); p(1, 2, C.fY, 8, 6);
  p(2, 7, '#caa83a', 6, 2); p(1, 6, '#caa83a', 1, 2); p(8, 6, '#caa83a', 1, 2);
  p(3, 2, '#fbe98c', 3, 1); p(2, 3, '#fbe98c', 1, 2);
  p(4, 3, '#caa83a', 2, 4);
  return c;
}
function iconWood() {
  const [c, g] = mkc(10, 10); const p = px(g);
  p(0, 3, C.wood, 8, 4); p(0, 3, C.woodL, 8, 1); p(0, 6, C.woodD, 8, 1);
  p(7, 2, C.plank, 3, 6); p(8, 4, C.wood, 1, 2);
  return c;
}
function iconStone() {
  const [c, g] = mkc(10, 10); const p = px(g);
  p(2, 3, C.stone, 6, 6); p(1, 5, C.stone, 8, 3);
  p(2, 3, C.stoneL, 4, 2); p(2, 8, C.stoneD, 7, 1); p(6, 4, C.stoneD, 1, 4);
  return c;
}
function iconFood() {
  const [c, g] = mkc(10, 10); const p = px(g);
  p(4, 1, '#caa83a', 2, 8);
  p(2, 1, C.fY, 2, 2); p(6, 1, C.fY, 2, 2); p(3, 3, C.fY, 1, 2); p(6, 3, C.fY, 1, 2);
  p(2, 4, C.fY, 2, 2); p(6, 4, C.fY, 2, 2); p(4, 0, C.fY, 2, 1);
  return c;
}
function iconPop() {
  const [c, g] = mkc(10, 10); const p = px(g);
  p(3, 0, '#e8c9a0', 4, 4); p(3, 0, '#f5dcb8', 4, 1);
  p(2, 5, C.fR, 6, 5); p(2, 5, C.fR2, 6, 1); p(4, 6, '#9c2c24', 2, 4);
  return c;
}
function iconWorker() {
  const [c, g] = mkc(10, 10); const p = px(g);
  p(3, 1, '#e8c9a0', 4, 3); p(2, 0, C.fY, 6, 2); p(1, 1, C.fY, 8, 1);
  p(2, 5, '#5b7ea3', 6, 5); p(2, 5, '#7da3cc', 6, 1); p(4, 6, '#41617f', 2, 4);
  return c;
}

// ---------- building definitions ----------
const DEFS = {
  path:    { name: 'Path',        w: 1, h: 1, cost: { gold: 2 }, terrain: true,
             desc: 'Tidy paving for your streets. Click and drag to paint.' },
  garden:  { name: 'Garden',      w: 1, h: 1, cost: { gold: 15 }, boost: 0.10,
             desc: 'A bed of flowers. Boosts production of nearby buildings by 10%.' },
  cottage: { name: 'Cottage',     w: 2, h: 2, cost: { gold: 40, wood: 20 }, pop: 3, interval: 8, prod: { gold: 2 },
             desc: 'A cozy home for 3 villagers, who pay taxes.' },
  farm:    { name: 'Farm',        w: 3, h: 3, cost: { gold: 60, wood: 30 }, workers: 2, interval: 10, prod: { food: 4 },
             desc: 'Grows food to feed your villagers.' },
  lumber:  { name: 'Lumber Camp', w: 2, h: 2, cost: { gold: 50, wood: 10 }, workers: 2, interval: 12, prod: { wood: 3 }, needs: 'tree',
             desc: 'Harvests timber. Must be built next to trees.' },
  quarry:  { name: 'Quarry',      w: 2, h: 2, cost: { gold: 80, wood: 20 }, workers: 3, interval: 14, prod: { stone: 3 }, needs: 'rock',
             desc: 'Mines stone. Must be built next to rocks.' },
  well:    { name: 'Well',        w: 1, h: 1, cost: { gold: 30, stone: 10 }, boost: 0.25,
             desc: 'Fresh water! Boosts production of nearby buildings by 25%.' },
  bakery:  { name: 'Bakery',      w: 2, h: 2, cost: { gold: 110, wood: 30, stone: 20 }, workers: 2, interval: 9, prod: { gold: 8 }, eats: { food: 2 },
             desc: 'Bakes 2 food into bread worth 8 gold.' },
  market:  { name: 'Market',      w: 3, h: 3, cost: { gold: 150, wood: 40, stone: 20 }, workers: 2, interval: 10, sells: true,
             desc: 'Sells surplus food (beyond one day’s rations) for 2 gold each, up to 4 at a time.' },
  manor:   { name: 'Manor',       w: 3, h: 3, cost: { gold: 320, wood: 80, stone: 60 }, pop: 8, interval: 10, prod: { gold: 12 },
             desc: 'A grand estate housing 8 wealthy villagers who pay hefty taxes.' },
};
const SHOP_ORDER = ['path', 'garden', 'cottage', 'farm', 'lumber', 'quarry', 'well', 'bakery', 'market', 'manor'];
const SPRITE_FNS = {
  cottage: spriteCottage, farm: spriteFarm, lumber: spriteLumber, quarry: spriteQuarry,
  well: spriteWell, garden: spriteGarden, bakery: spriteBakery, market: spriteMarket, manor: spriteManor,
};

// ---------- sprite cache ----------
const SPR = { ground: [], grass: [], tree: [], rock: [], path: null, b: {}, icons: {} };
function buildSprites() {
  const R = mulberry32(1337);
  for (let i = 0; i < 8; i++) SPR.ground.push(spriteGround(R, i));
  for (let i = 0; i < 4; i++) SPR.grass.push(spriteGrass(R));
  const flowers = [[C.fR, C.fR2], [C.fP, C.fP2], [C.fO, C.fOL], null];
  for (const f of flowers) SPR.tree.push(spriteTree(R, f));
  SPR.rock.push(spriteRock(R)); SPR.rock.push(spriteRock(R));
  SPR.path = spritePath(R);
  for (const k in SPRITE_FNS) SPR.b[k] = SPRITE_FNS[k](R);
  SPR.icons = { gold: iconGold(), wood: iconWood(), stone: iconStone(), food: iconFood(), pop: iconPop(), worker: iconWorker() };
}

// ---------- game state ----------
const T_GROUND = 0, T_GRASS = 1, T_TREE = 2, T_ROCK = 3, T_PATH = 4;
let state = null;
let occ = [];          // grid of building refs (or null), rebuilt from state.buildings
let terrainLayer = null, terrainCtx = null;
let floats = [];       // floating production texts
let mode = 'idle';     // 'idle' | 'place' | 'demolish'
let selected = null;   // building type being placed
let hover = { x: -1, y: -1 };
let painting = false;  // path drag-paint
let lastSpeed = 1;
let saveTimer = 0;

function genMap(seed) {
  const R = mulberry32(seed);
  const t = [];
  for (let y = 0; y < ROWS; y++) t.push(new Array(COLS).fill(T_GROUND));
  const cx = COLS / 2, cy = ROWS / 2;
  const nearCenter = (x, y, r) => Math.abs(x - cx) < r && Math.abs(y - cy) < r * 0.7;
  // grass fringe along edges
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const edge = Math.min(x, y, COLS - 1 - x, ROWS - 1 - y);
    if (edge === 0 && R() < 0.85) t[y][x] = T_GRASS;
    else if (edge === 1 && R() < 0.45) t[y][x] = T_GRASS;
  }
  // grass meadow blobs
  for (let i = 0; i < 10; i++) {
    const bx = 2 + R() * (COLS - 4), by = 2 + R() * (ROWS - 4), r = 1.5 + R() * 2.5;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const d = Math.hypot(x - bx, y - by);
      if (d < r && R() < 0.8 && !nearCenter(x, y, 5)) t[y][x] = T_GRASS;
    }
  }
  // smooth grass edges into organic patches (2 cellular-automata passes)
  for (let pass = 0; pass < 2; pass++) {
    const snap = t.map(row => row.slice());
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= ROWS || xx >= COLS) { n++; continue; }
        if (snap[yy][xx] === T_GRASS) n++;
      }
      if (snap[y][x] === T_GRASS && n <= 2) t[y][x] = T_GROUND;
      else if (snap[y][x] === T_GROUND && n >= 5 && !nearCenter(x, y, 5)) t[y][x] = T_GRASS;
    }
  }
  // tree clusters (biased toward edges)
  for (let i = 0; i < 9; i++) {
    const side = (R() * 4) | 0;
    let bx, by;
    if (side === 0) { bx = 1 + R() * 6; by = 1 + R() * (ROWS - 2); }
    else if (side === 1) { bx = COLS - 7 + R() * 6; by = 1 + R() * (ROWS - 2); }
    else if (side === 2) { bx = 1 + R() * (COLS - 2); by = 1 + R() * 5; }
    else { bx = 1 + R() * (COLS - 2); by = ROWS - 6 + R() * 5; }
    const n = 4 + (R() * 6) | 0;
    for (let j = 0; j < n; j++) {
      const x = clamp((bx + (R() * 6 - 3)) | 0, 0, COLS - 1);
      const y = clamp((by + (R() * 5 - 2.5)) | 0, 0, ROWS - 1);
      if (!nearCenter(x, y, 6)) { t[y][x] = T_TREE; }
    }
  }
  // rock clusters
  for (let i = 0; i < 5; i++) {
    const bx = 2 + R() * (COLS - 4), by = 2 + R() * (ROWS - 4);
    if (nearCenter(bx, by, 7)) continue;
    const n = 2 + (R() * 4) | 0;
    for (let j = 0; j < n; j++) {
      const x = clamp((bx + (R() * 4 - 2)) | 0, 0, COLS - 1);
      const y = clamp((by + (R() * 4 - 2)) | 0, 0, ROWS - 1);
      if (!nearCenter(x, y, 6)) t[y][x] = T_ROCK;
    }
  }
  // guarantee at least a few trees and rocks
  let trees = 0, rocks = 0;
  for (const row of t) for (const v of row) { if (v === T_TREE) trees++; if (v === T_ROCK) rocks++; }
  while (trees < 6) { const x = (R() * COLS) | 0, y = (R() * 5) | 0; if (t[y][x] <= T_GRASS) { t[y][x] = T_TREE; trees++; } }
  while (rocks < 4) { const x = (R() * COLS) | 0, y = ROWS - 1 - ((R() * 5) | 0); if (t[y][x] <= T_GRASS) { t[y][x] = T_ROCK; rocks++; } }
  return t;
}

function newGame() {
  state = {
    terrain: genMap((Math.random() * 1e9) | 0),
    buildings: [],
    gold: 150, wood: 60, stone: 30, food: 30,
    pop: 0, day: 1, tod: 0.35, speed: 1,
    flags: {},
  };
  // free starter cottage in the middle
  placeBuilding('cottage', (COLS >> 1) - 1, (ROWS >> 1) - 1, true);
  rebuildAll();
  toast('Welcome to Stonebrook! Build cottages for villagers, then put them to work.');
}

function rebuildAll() {
  occ = [];
  for (let y = 0; y < ROWS; y++) occ.push(new Array(COLS).fill(null));
  for (const b of state.buildings) {
    const d = DEFS[b.type];
    for (let y = b.y; y < b.y + d.h; y++) for (let x = b.x; x < b.x + d.w; x++) occ[y][x] = b;
  }
  recomputePop();
  recomputeBoosts();
  buildTerrainLayer();
}

function recomputePop() {
  let pop = 0;
  for (const b of state.buildings) pop += DEFS[b.type].pop || 0;
  state.pop = pop;
}
function workersNeeded() {
  let n = 0;
  for (const b of state.buildings) n += DEFS[b.type].workers || 0;
  return n;
}
function workerEff() {
  const need = workersNeeded();
  return need > 0 ? Math.min(1, state.pop / need) : 1;
}
function recomputeBoosts() {
  const boosters = state.buildings.filter(b => DEFS[b.type].boost);
  for (const b of state.buildings) {
    const d = DEFS[b.type];
    if (!d.interval) { b.boost = 1; continue; }
    let m = 1;
    for (const w of boosters) {
      const dw = DEFS[w.type];
      const sx = Math.max(w.x - (b.x + d.w - 1), b.x - (w.x + dw.w - 1));
      const sy = Math.max(w.y - (b.y + d.h - 1), b.y - (w.y + dw.h - 1));
      if (Math.max(sx, sy) <= 2) m += dw.boost;
    }
    b.boost = Math.min(1.75, m);
  }
}

// ---------- placement / demolition ----------
function canAfford(def) {
  for (const k in def.cost) if (state[k] < def.cost[k]) return false;
  return true;
}
function footprintOk(def, tx, ty) {
  if (tx < 0 || ty < 0 || tx + def.w > COLS || ty + def.h > ROWS) return false;
  for (let y = ty; y < ty + def.h; y++) for (let x = tx; x < tx + def.w; x++) {
    const t = state.terrain[y][x];
    if (t === T_TREE || t === T_ROCK) return false;
    if (occ[y][x]) return false;
  }
  return true;
}
function adjacencyOk(def, tx, ty) {
  if (!def.needs) return true;
  const want = def.needs === 'tree' ? T_TREE : T_ROCK;
  for (let y = ty - 1; y <= ty + def.h; y++) for (let x = tx - 1; x <= tx + def.w; x++) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
    if (state.terrain[y][x] === want) return true;
  }
  return false;
}
function canPlace(type, tx, ty) {
  const def = DEFS[type];
  return footprintOk(def, tx, ty) && adjacencyOk(def, tx, ty);
}
function placeBuilding(type, tx, ty, free) {
  const def = DEFS[type];
  if (!free) {
    if (!canAfford(def)) { sError(); toast('Not enough resources!'); return false; }
    if (!canPlace(type, tx, ty)) {
      if (!footprintOk(def, tx, ty)) return false;
      sError();
      toast(def.needs === 'tree' ? 'A Lumber Camp must touch trees.' : 'A Quarry must touch rocks.');
      return false;
    }
    for (const k in def.cost) state[k] -= def.cost[k];
  }
  if (def.terrain) {
    state.terrain[ty][tx] = T_PATH;
    buildTerrainLayer();
  } else {
    const b = { type, x: tx, y: ty, t: 0, boost: 1 };
    state.buildings.push(b);
    if (occ.length) for (let y = ty; y < ty + def.h; y++) for (let x = tx; x < tx + def.w; x++) occ[y][x] = b;
    recomputePop();
    recomputeBoosts();
  }
  if (!free) { sPlace(); saveSoon(); }
  return true;
}
function demolishAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return;
  const ter = state.terrain[ty][tx];
  if (ter === T_TREE) {
    state.terrain[ty][tx] = T_GRASS; state.wood += 5;
    addFloat(tx * TILE + 8, ty * TILE, '+5', 'wood'); sSell(); buildTerrainLayer(); saveSoon(); return;
  }
  if (ter === T_ROCK) {
    state.terrain[ty][tx] = T_GRASS; state.stone += 5;
    addFloat(tx * TILE + 8, ty * TILE, '+5', 'stone'); sSell(); buildTerrainLayer(); saveSoon(); return;
  }
  if (ter === T_PATH && !occ[ty][tx]) {
    state.terrain[ty][tx] = T_GROUND; state.gold += 1;
    sSell(); buildTerrainLayer(); saveSoon(); return;
  }
  const b = occ[ty][tx];
  if (!b) return;
  const def = DEFS[b.type];
  for (const k in def.cost) {
    const back = Math.floor(def.cost[k] * 0.6);
    if (back > 0) { state[k] += back; }
  }
  addFloat((b.x + def.w / 2) * TILE, b.y * TILE, '+' + Math.floor((def.cost.gold || 0) * 0.6), 'gold');
  state.buildings.splice(state.buildings.indexOf(b), 1);
  for (let y = b.y; y < b.y + def.h; y++) for (let x = b.x; x < b.x + def.w; x++) occ[y][x] = null;
  recomputePop();
  recomputeBoosts();
  sSell(); saveSoon();
}

// ---------- economy ----------
function addFloat(x, y, txt, res) {
  floats.push({ x, y, txt, res, age: 0 });
  if (floats.length > 60) floats.shift();
}
function produce(b, def, starving) {
  const d = DEFS[b.type];
  const cx = (b.x + d.w / 2) * TILE, cy = b.y * TILE + 2;
  let dy = 0;
  for (const k in def.prod) {
    let amt = def.prod[k];
    if (k === 'gold' && starving) amt = Math.max(1, Math.ceil(amt / 2));
    state[k] += amt;
    addFloat(cx, cy + dy, '+' + amt, k);
    dy -= 8;
  }
}
function tickEconomy(sdt) {
  state.tod += sdt / DAY_LEN;
  if (state.tod >= 1) { state.tod -= 1; state.day++; }
  if (state.pop > 0) state.food = Math.max(0, state.food - state.pop * sdt / DAY_LEN);
  const starving = state.pop > 0 && state.food <= 0;
  if (starving && !state.flags.starveWarn) {
    state.flags.starveWarn = true;
    toast('⚠ Your villagers are hungry! Gold income is halved. Build farms!');
    sError();
  }
  if (!starving) state.flags.starveWarn = false;
  const wEff = workerEff();
  for (const b of state.buildings) {
    const def = DEFS[b.type];
    if (!def.interval) continue;
    const m = (b.boost || 1) * (def.workers ? wEff : 1);
    b.t += sdt * m;
    if (b.t < def.interval) continue;
    if (def.eats) {
      if (state.food >= def.eats.food) {
        state.food -= def.eats.food;
        produce(b, def, starving);
        b.t -= def.interval;
      } else { b.t = def.interval; stallFloat(b, def, 'no food', sdt); }
    } else if (def.sells) {
      const surplus = Math.floor(state.food - state.pop);
      const amt = Math.min(4, surplus);
      if (amt > 0) {
        state.food -= amt;
        const gold = amt * 2;
        state.gold += starving ? Math.ceil(gold / 2) : gold;
        addFloat((b.x + def.w / 2) * TILE, b.y * TILE + 2, '+' + gold, 'gold');
        b.t -= def.interval;
      } else { b.t = def.interval; stallFloat(b, def, 'no surplus', sdt); }
    } else {
      produce(b, def, starving);
      b.t -= def.interval;
    }
  }
}
function stallFloat(b, def, msg, sdt) {
  b.stallT = (b.stallT || 0) + sdt;
  if (b.stallT >= 4) {
    b.stallT = 0;
    floats.push({ x: (b.x + def.w / 2) * TILE, y: b.y * TILE + 2, txt: msg, res: null, age: 0 });
  }
}
function checkMilestones() {
  const f = state.flags;
  const hit = (key, cond, msg) => { if (!f[key] && cond) { f[key] = true; toast(msg); sSell(); } };
  hit('pop10', state.pop >= 10, '🏡 Ten villagers — your hamlet is growing!');
  hit('pop25', state.pop >= 25, '🎉 Twenty-five villagers — a proper village!');
  hit('pop50', state.pop >= 50, '🏰 Fifty villagers — Stonebrook is a real town!');
  hit('gold1k', state.gold >= 1000, '💰 A thousand gold in the treasury!');
}

// ---------- save / load ----------
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      terrain: state.terrain, gold: state.gold, wood: state.wood, stone: state.stone,
      food: state.food, day: state.day, tod: state.tod, speed: state.speed, flags: state.flags,
      buildings: state.buildings.map(b => ({ type: b.type, x: b.x, y: b.y, t: b.t })),
    }));
  } catch (e) { /* storage unavailable; play on without saves */ }
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s || !s.terrain || s.terrain.length !== ROWS) return false;
    state = {
      terrain: s.terrain, buildings: [],
      gold: s.gold, wood: s.wood, stone: s.stone, food: s.food,
      pop: 0, day: s.day || 1, tod: s.tod || 0.35, speed: s.speed ?? 1,
      flags: s.flags || {},
    };
    for (const b of s.buildings || []) {
      if (DEFS[b.type]) state.buildings.push({ type: b.type, x: b.x, y: b.y, t: b.t || 0, boost: 1 });
    }
    rebuildAll();
    return true;
  } catch (e) { return false; }
}
function saveSoon() { saveTimer = Math.min(saveTimer, 0.5); }

// ---------- sound ----------
let actx = null, muted = false;
function ensureAudio() { if (!actx) try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
function beep(freq, dur = 0.08, type = 'square', gain = 0.035, delay = 0) {
  if (muted || !actx) return;
  const t0 = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function sPlace() { beep(392, 0.07); beep(587, 0.10, 'square', 0.03, 0.07); }
function sSell() { beep(740, 0.05, 'triangle'); beep(988, 0.09, 'triangle', 0.03, 0.05); }
function sError() { beep(110, 0.16, 'sawtooth', 0.04); }
function sClick() { beep(520, 0.04, 'triangle', 0.025); }

// ---------- terrain layer ----------
function buildTerrainLayer() {
  if (!terrainLayer) { [terrainLayer, terrainCtx] = mkc(W, H); }
  const g = terrainCtx;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const t = state.terrain[y][x], h = hash2(x, y);
    if (t === T_GROUND) g.drawImage(SPR.ground[h % SPR.ground.length], x * TILE, y * TILE);
    else if (t === T_PATH) g.drawImage(SPR.path, x * TILE, y * TILE);
    else g.drawImage(SPR.grass[h % SPR.grass.length], x * TILE, y * TILE);
    if (t === T_TREE) g.drawImage(SPR.tree[h % SPR.tree.length], x * TILE, y * TILE);
    else if (t === T_ROCK) g.drawImage(SPR.rock[h % SPR.rock.length], x * TILE, y * TILE);
  }
}

// ---------- DOM / UI ----------
const $ = id => document.getElementById(id);
let canvas, ctx, tooltip;
const hudCache = {};

function setHud(id, val) {
  if (hudCache[id] !== val) { hudCache[id] = val; $(id).textContent = val; }
}
function costHtml(cost) {
  let s = '';
  for (const k in cost) s += `<img src="${SPR.icons[k].toDataURL()}" alt="${k}"><b>${cost[k]}</b>`;
  return s;
}
function prodText(def) {
  if (def.boost) return `+${Math.round(def.boost * 100)}% to nearby buildings`;
  if (def.sells) return 'sells surplus food → gold';
  if (def.eats) return `2 food → ${def.prod.gold} gold every ${def.interval}s`;
  if (def.prod) {
    const parts = [];
    for (const k in def.prod) parts.push(`+${def.prod[k]} ${k}`);
    return `${parts.join(', ')} every ${def.interval}s`;
  }
  return 'decoration';
}
function extraText(def) {
  const bits = [];
  if (def.pop) bits.push(`houses ${def.pop} villagers`);
  if (def.workers) bits.push(`needs ${def.workers} workers`);
  if (def.needs) bits.push(`build next to ${def.needs}s`);
  return bits.join(' · ');
}

function buildShop() {
  const shop = $('shop');
  // demolish tool
  const dem = document.createElement('button');
  dem.className = 'card tool'; dem.id = 'toolDemolish';
  dem.innerHTML = `<div class="cardicon">⛏</div><div class="cname">Demolish</div><div class="ccost">60% refund</div>`;
  dem.onclick = () => { ensureAudio(); sClick(); setMode(mode === 'demolish' ? 'idle' : 'demolish'); };
  dem.onmouseenter = e => showTip(e, '<b>Demolish</b><br>Remove buildings for a 60% refund.<br>Chop trees for +5 wood, clear rocks for +5 stone.');
  dem.onmouseleave = hideTip;
  shop.appendChild(dem);

  for (const type of SHOP_ORDER) {
    const def = DEFS[type];
    const card = document.createElement('button');
    card.className = 'card'; card.dataset.type = type;
    const mini = document.createElement('canvas');
    mini.width = 48; mini.height = 48; mini.className = 'cardicon';
    const mg = mini.getContext('2d'); mg.imageSmoothingEnabled = false;
    const spr = SPR.b[type] || (type === 'path' ? SPR.path : null);
    if (spr) {
      const s = Math.min(48 / spr.width, 48 / spr.height);
      const dw = spr.width * s, dh = spr.height * s;
      mg.drawImage(spr, (48 - dw) / 2, (48 - dh) / 2, dw, dh);
    }
    card.appendChild(mini);
    const nm = document.createElement('div'); nm.className = 'cname'; nm.textContent = def.name;
    const cs = document.createElement('div'); cs.className = 'ccost'; cs.innerHTML = costHtml(def.cost);
    card.appendChild(nm); card.appendChild(cs);
    card.onclick = () => {
      ensureAudio(); sClick();
      if (selected === type && mode === 'place') setMode('idle');
      else { selected = type; setMode('place'); }
    };
    card.onmouseenter = e => {
      const extra = extraText(def);
      showTip(e, `<b>${def.name}</b> — ${def.w}×${def.h}<br>${def.desc}<br><i>${prodText(def)}</i>${extra ? '<br>' + extra : ''}`);
    };
    card.onmouseleave = hideTip;
    shop.appendChild(card);
  }
}
function refreshShop() {
  document.querySelectorAll('#shop .card').forEach(el => {
    const type = el.dataset.type;
    if (type) {
      el.classList.toggle('off', !canAfford(DEFS[type]));
      el.classList.toggle('sel', mode === 'place' && selected === type);
    } else {
      el.classList.toggle('sel', mode === 'demolish');
    }
  });
}
function setMode(m) {
  mode = m;
  if (m !== 'place') selected = null;
  canvas.classList.toggle('demolish', m === 'demolish');
  refreshShop();
}

function showTip(e, html) {
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  moveTip(e);
}
function moveTip(e) {
  if (tooltip.style.display === 'none') return;
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  const r = tooltip.getBoundingClientRect();
  if (x + r.width > innerWidth - 4) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight - 4) y = e.clientY - r.height - pad;
  tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
}
function hideTip() { tooltip.style.display = 'none'; }

function toast(msg) {
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, 4200);
  while (box.children.length > 4) box.firstChild.remove();
}

function buildHud() {
  const res = $('res');
  const mk = (icon, id, tipHtml) => {
    const span = document.createElement('span');
    span.className = 'res';
    const img = document.createElement('img');
    img.src = SPR.icons[icon].toDataURL();
    const val = document.createElement('span'); val.id = id; val.textContent = '0';
    span.appendChild(img); span.appendChild(val);
    span.onmouseenter = e => showTip(e, tipHtml);
    span.onmouseleave = hideTip;
    res.appendChild(span);
  };
  mk('gold', 'hGold', '<b>Gold</b> — earned from taxes, bakeries and markets.');
  mk('wood', 'hWood', '<b>Wood</b> — from lumber camps, or chop trees with the demolish tool.');
  mk('stone', 'hStone', '<b>Stone</b> — from quarries, or clear rocks with the demolish tool.');
  mk('food', 'hFood', '<b>Food</b> — grown on farms. Each villager eats 1 per day. Run out and income halves!');
  mk('pop', 'hPop', '<b>Population</b> — villagers living in cottages and manors.');
  mk('worker', 'hWork', '<b>Workers</b> — jobs needed / villagers available. Short-staffed buildings run slower.');
}
function updateHud() {
  setHud('hGold', Math.floor(state.gold));
  setHud('hWood', Math.floor(state.wood));
  setHud('hStone', Math.floor(state.stone));
  setHud('hFood', Math.floor(state.food));
  setHud('hPop', state.pop);
  const need = workersNeeded();
  setHud('hWork', `${need}/${state.pop}`);
  $('hWork').parentElement.classList.toggle('warn', need > state.pop);
  $('hFood').parentElement.classList.toggle('warn', state.pop > 0 && state.food < state.pop);
  setHud('hDay', 'Day ' + state.day);
  // clock face: sun/moon
  const t = state.tod;
  setHud('hClock', (t > 0.25 && t < 0.8) ? '☀' : '☾');
}
function buildTimeControls() {
  const speeds = [['⏸', 0], ['½×', 0.5], ['1×', 1], ['2×', 2], ['4×', 4]];
  const bar = $('speeds');
  for (const [label, sp] of speeds) {
    const b = document.createElement('button');
    b.className = 'tbtn'; b.textContent = label; b.dataset.speed = sp;
    b.onclick = () => { ensureAudio(); sClick(); setSpeed(sp); };
    bar.appendChild(b);
  }
  $('muteBtn').onclick = () => {
    ensureAudio(); muted = !muted;
    $('muteBtn').textContent = muted ? '🔇' : '🔊';
    try { localStorage.setItem('stonebrook-muted', muted ? '1' : '0'); } catch (e) { }
  };
  $('newBtn').onclick = () => {
    if (confirm('Start a brand new town? Your current town will be lost.')) {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
      newGame(); setMode('idle'); floats = [];
    }
  };
}
function setSpeed(sp) {
  if (sp > 0) lastSpeed = sp;
  state.speed = sp;
  document.querySelectorAll('.tbtn').forEach(b => b.classList.toggle('sel', +b.dataset.speed === sp));
}

// ---------- input ----------
function tileFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / r.width * COLS);
  const y = Math.floor((e.clientY - r.top) / r.height * ROWS);
  return { x, y };
}
function bindInput() {
  canvas.addEventListener('mousemove', e => {
    hover = tileFromEvent(e);
    if (painting && selected === 'path' && hover.x >= 0) {
      if (canPlace('path', hover.x, hover.y) && state.terrain[hover.y][hover.x] !== T_PATH) {
        placeBuilding('path', hover.x, hover.y);
      }
    }
    // map tooltips when idle
    if (mode === 'idle' && hover.x >= 0 && hover.x < COLS && hover.y >= 0 && hover.y < ROWS) {
      const b = occ[hover.y] && occ[hover.y][hover.x];
      if (b) {
        const def = DEFS[b.type];
        let status = '';
        if (def.workers && workerEff() < 1) status = `<br><span class="bad">short-staffed: ${Math.round(workerEff() * 100)}% speed</span>`;
        const boost = b.boost > 1 ? `<br><span class="good">boosted +${Math.round((b.boost - 1) * 100)}%</span>` : '';
        showTip(e, `<b>${def.name}</b><br><i>${prodText(def)}</i>${boost}${status}`);
        return;
      }
      const t = state.terrain[hover.y][hover.x];
      if (t === T_TREE) { showTip(e, '<b>Tree</b><br>Lumber camps work beside trees.<br>Demolish to chop: +5 wood.'); return; }
      if (t === T_ROCK) { showTip(e, '<b>Rocks</b><br>Quarries work beside rocks.<br>Demolish to clear: +5 stone.'); return; }
      hideTip();
    } else if (mode !== 'idle') hideTip();
    moveTip(e);
  });
  canvas.addEventListener('mouseleave', () => { hover = { x: -1, y: -1 }; hideTip(); });
  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    ensureAudio();
    const { x, y } = tileFromEvent(e);
    if (mode === 'place' && selected) {
      const def = DEFS[selected];
      if (selected === 'path') {
        painting = true;
        if (canPlace('path', x, y) && state.terrain[y][x] !== T_PATH) placeBuilding('path', x, y);
      } else if (canPlace(selected, x, y)) {
        placeBuilding(selected, x, y);
      } else if (footprintOk(def, x, y) && !adjacencyOk(def, x, y)) {
        sError();
        toast(def.needs === 'tree' ? 'A Lumber Camp must be next to trees.' : 'A Quarry must be next to rocks.');
      } else sError();
    } else if (mode === 'demolish') {
      demolishAt(x, y);
    }
  });
  addEventListener('mouseup', () => { painting = false; });
  canvas.addEventListener('contextmenu', e => { e.preventDefault(); setMode('idle'); });
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); setSpeed(state.speed === 0 ? lastSpeed : 0); }
    else if (e.key === 'Escape') setMode('idle');
    else if (e.key === '1') setSpeed(1);
    else if (e.key === '2') setSpeed(2);
    else if (e.key === '3') setSpeed(4);
    else if (e.key === '4') setSpeed(0.5);
    else if (e.key.toLowerCase() === 'x') setMode(mode === 'demolish' ? 'idle' : 'demolish');
  });
  addEventListener('resize', fit);
}
function fit() {
  const vp = $('viewport');
  const aw = vp.clientWidth - 8, ah = vp.clientHeight - 8;
  let s = Math.min(aw / W, ah / H);
  if (s >= 3) s = Math.floor(s);
  else if (s >= 1) s = Math.floor(s * 4) / 4; // quarter steps keep pixels mostly even
  else s = Math.max(0.5, s);
  canvas.style.width = (W * s) + 'px';
  canvas.style.height = (H * s) + 'px';
}

// ---------- render ----------
function render(now) {
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(terrainLayer, 0, 0);
  // buildings (sorted so southern sprites draw last)
  const sorted = state.buildings.slice().sort((a, b) => (a.y + DEFS[a.type].h) - (b.y + DEFS[b.type].h));
  for (const b of sorted) ctx.drawImage(SPR.b[b.type], b.x * TILE, b.y * TILE);
  // placement preview
  if (mode === 'place' && selected && hover.x >= 0) {
    const def = DEFS[selected];
    const ok = canPlace(selected, hover.x, hover.y);
    for (let y = hover.y; y < hover.y + def.h; y++) for (let x = hover.x; x < hover.x + def.w; x++) {
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
      ctx.fillStyle = ok ? 'rgba(110,220,90,0.35)' : 'rgba(220,70,50,0.40)';
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
    const spr = selected === 'path' ? SPR.path : SPR.b[selected];
    if (spr && hover.x + def.w <= COLS && hover.y + def.h <= ROWS) {
      ctx.globalAlpha = 0.65;
      ctx.drawImage(spr, hover.x * TILE, hover.y * TILE);
      ctx.globalAlpha = 1;
    }
  }
  // demolish highlight
  if (mode === 'demolish' && hover.x >= 0 && hover.x < COLS && hover.y >= 0 && hover.y < ROWS) {
    const b = occ[hover.y][hover.x];
    ctx.fillStyle = 'rgba(220,60,40,0.4)';
    if (b) {
      const d = DEFS[b.type];
      ctx.fillRect(b.x * TILE, b.y * TILE, d.w * TILE, d.h * TILE);
    } else {
      const t = state.terrain[hover.y][hover.x];
      if (t === T_TREE || t === T_ROCK || t === T_PATH) ctx.fillRect(hover.x * TILE, hover.y * TILE, TILE, TILE);
    }
  }
  // hover outline when idle
  if (mode === 'idle' && hover.x >= 0 && hover.x < COLS && hover.y >= 0 && hover.y < ROWS) {
    const b = occ[hover.y][hover.x];
    if (b) {
      const d = DEFS[b.type];
      ctx.strokeStyle = 'rgba(255,245,210,0.8)';
      ctx.strokeRect(b.x * TILE + 0.5, b.y * TILE + 0.5, d.w * TILE - 1, d.h * TILE - 1);
    }
  }
  // floating texts
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center';
  for (const f of floats) {
    const a = 1 - f.age / 1.4;
    ctx.globalAlpha = Math.max(0, a);
    const y = f.y - f.age * 12;
    ctx.fillStyle = '#1a120a';
    ctx.fillText(f.txt, f.x + 1, y + 1);
    ctx.fillStyle = f.res ? RES_COLORS[f.res] : '#d8c8a8';
    ctx.fillText(f.txt, f.x, y);
    if (f.res) ctx.drawImage(SPR.icons[f.res], f.x + ctx.measureText(f.txt).width / 2 + 1, y - 8, 8, 8);
  }
  ctx.globalAlpha = 1;
  // day/night tint
  const t = state.tod;
  const bright = 0.5 - 0.5 * Math.cos(2 * Math.PI * t); // 0 = midnight, 1 = noon
  const night = (1 - bright) * 0.45;
  if (night > 0.02) {
    ctx.fillStyle = `rgba(18,26,64,${night.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }
  const dusk = Math.max(0, 1 - Math.abs(t - 0.80) * 14) + Math.max(0, 1 - Math.abs(t - 0.22) * 14);
  if (dusk > 0.02) {
    ctx.fillStyle = `rgba(225,120,50,${(dusk * 0.10).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const rdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const sdt = rdt * state.speed;
  if (sdt > 0) tickEconomy(sdt);
  for (const f of floats) f.age += rdt;
  floats = floats.filter(f => f.age < 1.4);
  checkMilestones();
  updateHud();
  refreshShop();
  saveTimer -= rdt;
  if (saveTimer <= 0) { save(); saveTimer = 10; }
  render(now / 1000);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
function init() {
  canvas = $('game');
  canvas.width = W; canvas.height = H;
  ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  tooltip = $('tooltip');
  buildSprites();
  if (!load()) newGame();
  try { muted = localStorage.getItem('stonebrook-muted') === '1'; } catch (e) { }
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
  buildHud();
  buildShop();
  buildTimeControls();
  setSpeed(state.speed ?? 1);
  bindInput();
  fit();
  saveTimer = 10;
  requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
}
document.addEventListener('DOMContentLoaded', init);
