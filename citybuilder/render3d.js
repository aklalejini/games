'use strict';
/* ============================================================
   STONEBROOK 3D renderer v3 — "painted fjord" look.
   Snow-capped ridged mountains, a waterfall into the fjord,
   clouds / stars / moon / aurora in a shader sky, swayback
   roofs with per-building variation (log, plank, plaster,
   sod roofs, lanterns, horns), instanced forest + meadow
   tufts, fireflies at night. Still no postprocessing and a
   single shadowed light — it all stays cheap.
   ============================================================ */

const R3 = (() => {
  let renderer, scene, camera, dom;
  let sun, ambient, hemi;
  let groundCanvas, groundCtx, groundTex, groundMesh;
  let scatterGroup, buildingGroup;
  const meshByBuilding = new Map();
  let previewTiles = null, hoverQuad = null, demoQuad = null;
  let models = {}, ghostModels = {};
  let TEX = {}, MAT = {};
  let skyMat, water, boat, waterfall = null;
  let birds = [], mists = [], clouds = [], auroras = [], motes = [], windmills = [];
  let tufts = null;
  let smokeEmitters = [], smokePool = [];
  let elapsed = 0, nightAmt = 0;

  // camera rig
  const target = new THREE.Vector3(0, 0.5, -1.5);
  let yaw = 0, pitch = 0.62, zoom = 1.35;
  const DIST = 70, VIEW = 11;
  let dragBtn = -1, dragX = 0, dragY = 0, didDrag = false;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // ---------- math helpers ----------
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  function vhash(ix, iz) {
    let h = (ix * 374761393 + iz * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (((h ^ (h >>> 16)) >>> 0) / 4294967296);
  }
  function vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = vhash(ix, iz), b = vhash(ix + 1, iz), c = vhash(ix, iz + 1), d = vhash(ix + 1, iz + 1);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
  }
  function fbm(x, z) { return vnoise(x, z) * 0.6 + vnoise(x * 2.13, z * 2.13) * 0.27 + vnoise(x * 4.7, z * 4.7) * 0.13; }
  const ridged = (x, z) => Math.pow(1 - Math.abs(2 * fbm(x, z) - 1), 2);

  // ---------- textures ----------
  function makeTex(w, h, paint, repeat = true) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    paint(c.getContext('2d'), mulberry32(20260611));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    return t;
  }
  function speckle(g, w, h, n, colors, R, s = 2) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[(R() * colors.length) | 0];
      g.globalAlpha = 0.12 + R() * 0.25;
      g.fillRect(R() * w, R() * h, 1 + R() * s, 1 + R() * s);
    }
    g.globalAlpha = 1;
  }
  function lam(opts) { return new THREE.MeshLambertMaterial(opts); }

  function buildTextures() {
    TEX.plank = makeTex(128, 128, (g, R) => {
      g.fillStyle = '#6b5238'; g.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 16) {
        g.fillStyle = `rgb(${95 + R() * 30},${72 + R() * 24},${46 + R() * 18})`;
        g.fillRect(0, y, 128, 15);
        g.fillStyle = 'rgba(30,20,10,0.55)'; g.fillRect(0, y + 15, 128, 1.5);
        for (let i = 0; i < 7; i++) {
          g.strokeStyle = `rgba(40,28,14,${0.10 + R() * 0.12})`;
          g.beginPath();
          const yy = y + 2 + R() * 12;
          g.moveTo(0, yy); g.bezierCurveTo(40, yy + R() * 3 - 1.5, 90, yy + R() * 3 - 1.5, 128, yy);
          g.stroke();
        }
      }
      speckle(g, 128, 128, 220, ['#473722', '#8d7350', '#574631'], R);
    });
    // stacked log wall (rounded shading per course)
    TEX.log = makeTex(128, 128, (g, R) => {
      for (let y = 0; y < 128; y += 21) {
        const grd = g.createLinearGradient(0, y, 0, y + 21);
        grd.addColorStop(0, '#8a6c48');
        grd.addColorStop(0.35, `rgb(${130 + R() * 18},${100 + R() * 14},${64 + R() * 12})`);
        grd.addColorStop(0.85, '#4f3a24');
        grd.addColorStop(1, '#33240f');
        g.fillStyle = grd;
        g.fillRect(0, y, 128, 21);
        for (let i = 0; i < 5; i++) {
          g.strokeStyle = `rgba(60,42,22,${0.18 + R() * 0.18})`;
          const yy = y + 4 + R() * 13;
          g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(45, yy + R() * 2 - 1, 85, yy + R() * 2 - 1, 128, yy); g.stroke();
        }
        if (R() < 0.8) { // knot
          g.fillStyle = '#3d2c17';
          g.beginPath(); g.ellipse(10 + R() * 108, y + 8 + R() * 6, 2.6, 2, 0, 0, 7); g.fill();
        }
      }
    });
    // cut log ends (stack of circles) for firewood piles
    TEX.logEnd = makeTex(64, 64, (g, R) => {
      g.fillStyle = '#33260f'; g.fillRect(0, 0, 64, 64);
      for (let y = 8; y < 64; y += 15) for (let x = 8 + ((y / 15) % 2) * 7; x < 60; x += 15) {
        g.fillStyle = `rgb(${168 + R() * 30},${134 + R() * 24},${88 + R() * 18})`;
        g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fill();
        g.strokeStyle = 'rgba(90,60,30,0.7)';
        g.beginPath(); g.arc(x, y, 4, 0, 7); g.stroke();
        g.beginPath(); g.arc(x, y, 1.8, 0, 7); g.stroke();
      }
    });
    TEX.plaster = makeTex(128, 128, (g, R) => {
      g.fillStyle = '#d9cdb2'; g.fillRect(0, 0, 128, 128);
      speckle(g, 128, 128, 400, ['#c4b696', '#e6dcc4', '#b3a486'], R, 3);
      g.fillStyle = '#5a4630';
      g.fillRect(0, 0, 128, 7); g.fillRect(0, 121, 128, 7);
      g.fillRect(0, 0, 7, 128); g.fillRect(121, 0, 7, 128);
      g.fillRect(60, 0, 7, 128);
      g.save(); g.translate(34, 64); g.rotate(0.6); g.fillRect(-6, -70, 7, 140); g.restore();
      g.save(); g.translate(96, 64); g.rotate(-0.6); g.fillRect(-1, -70, 7, 140); g.restore();
    });
    TEX.shingle = makeTex(128, 128, (g, R) => {
      g.fillStyle = '#4f4a40'; g.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 11) {
        const off = ((y / 11) | 0) % 2 ? 9 : 0;
        for (let x = -18 + off; x < 128; x += 18) {
          const v = 72 + R() * 30;
          g.fillStyle = `rgb(${v},${v - 9 - R() * 8},${v - 20 - R() * 10})`;
          g.fillRect(x, y, 17, 10);
          g.fillStyle = 'rgba(25,20,15,0.5)';
          g.fillRect(x, y + 9, 17, 2);
          g.fillRect(x + 16, y, 2, 11);
          g.fillStyle = 'rgba(255,250,235,0.10)';
          g.fillRect(x, y, 17, 2);
        }
      }
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(${90 + R() * 30},${110 + R() * 35},${52 + R() * 20},${0.10 + R() * 0.16})`;
        g.beginPath(); g.arc(R() * 128, R() * 128, 4 + R() * 10, 0, 7); g.fill();
      }
    });
    // living sod roof — grass with tiny flowers
    TEX.sod = makeTex(96, 96, (g, R) => {
      g.fillStyle = '#4a6531'; g.fillRect(0, 0, 96, 96);
      for (let i = 0; i < 900; i++) {
        g.strokeStyle = `rgba(${45 + R() * 70},${82 + R() * 60},${26 + R() * 36},${0.25 + R() * 0.3})`;
        const x = R() * 96, y = R() * 96;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + R() * 3 - 1.5, y + 3 + R() * 3); g.stroke();
      }
      const cols = ['#e6e2d2', '#e3c95c', '#c87f9e'];
      for (let i = 0; i < 18; i++) {
        g.fillStyle = cols[(R() * 3) | 0];
        g.beginPath(); g.arc(R() * 96, R() * 96, 1.3, 0, 7); g.fill();
      }
    });
    TEX.stone = makeTex(96, 96, (g, R) => {
      g.fillStyle = '#7d8186'; g.fillRect(0, 0, 96, 96);
      for (let y = 0; y < 96; y += 16) {
        const off = ((y / 16) | 0) % 2 ? 12 : 0;
        for (let x = -24 + off; x < 96; x += 24) {
          const v = 112 + R() * 32;
          g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
          g.fillRect(x + 1, y + 1, 22, 14);
        }
      }
      speckle(g, 96, 96, 300, ['#5f6368', '#9aa0a6', '#6d7176'], R);
    });
    TEX.bark = makeTex(64, 64, (g, R) => {
      g.fillStyle = '#4f3d2a'; g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(${30 + R() * 30},${24 + R() * 22},${14 + R() * 14},0.6)`;
        const x = R() * 64;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x + R() * 8 - 4, 64); g.stroke();
      }
    });
    TEX.barrel = makeTex(64, 64, (g, R) => {
      g.fillStyle = '#6e5337'; g.fillRect(0, 0, 64, 64);
      for (let x = 0; x < 64; x += 9) {
        g.fillStyle = `rgb(${95 + R() * 25},${70 + R() * 18},${44 + R() * 12})`;
        g.fillRect(x, 0, 8, 64);
        g.fillStyle = 'rgba(25,15,8,0.5)'; g.fillRect(x + 8, 0, 1, 64);
      }
      g.fillStyle = '#3a3d42'; g.fillRect(0, 10, 64, 5); g.fillRect(0, 49, 64, 5);
    });
    TEX.door = makeTex(48, 64, (g, R) => {
      g.fillStyle = '#2c2014'; g.fillRect(0, 0, 48, 64);
      g.fillStyle = '#5d4730'; g.fillRect(3, 3, 42, 61);
      for (let x = 3; x < 45; x += 8) {
        g.fillStyle = `rgb(${88 + R() * 18},${66 + R() * 14},${42 + R() * 10})`;
        g.fillRect(x, 3, 7, 61);
        g.fillStyle = 'rgba(25,15,8,0.5)'; g.fillRect(x + 7, 3, 1, 61);
      }
      g.fillStyle = '#33363b'; g.fillRect(5, 14, 38, 4); g.fillRect(5, 44, 38, 4);
      g.fillStyle = '#d8c468'; g.beginPath(); g.arc(38, 33, 2.5, 0, 7); g.fill();
    }, false);
    TEX.window = makeTex(48, 48, (g) => {
      g.fillStyle = '#3a2c1c'; g.fillRect(0, 0, 48, 48);
      g.fillStyle = '#23262e';
      g.fillRect(6, 6, 16, 16); g.fillRect(26, 6, 16, 16);
      g.fillRect(6, 26, 16, 16); g.fillRect(26, 26, 16, 16);
      g.fillStyle = 'rgba(150,170,200,0.30)';
      g.fillRect(8, 8, 6, 6); g.fillRect(28, 8, 6, 6);
    }, false);
    TEX.windowGlow = makeTex(48, 48, (g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, 48, 48);
      g.fillStyle = '#ffb45e';
      g.fillRect(6, 6, 16, 16); g.fillRect(26, 6, 16, 16);
      g.fillRect(6, 26, 16, 16); g.fillRect(26, 26, 16, 16);
    }, false);
    TEX.sail = makeTex(64, 64, (g, R) => {
      g.fillStyle = '#cfc3a8'; g.fillRect(0, 0, 64, 64);
      for (let x = 0; x < 64; x += 16) { g.fillStyle = 'rgba(140,70,50,0.75)'; g.fillRect(x, 0, 8, 64); }
      speckle(g, 64, 64, 90, ['#9a8d72', '#e0d6bc'], R);
    }, false);
    TEX.field = makeTex(96, 96, (g, R) => {
      g.fillStyle = '#54422c'; g.fillRect(0, 0, 96, 96);
      for (let x = 4; x < 96; x += 12) {
        g.fillStyle = '#3f3120'; g.fillRect(x, 0, 5, 96);
        for (let y = 4; y < 96; y += 8) {
          if (R() < 0.85) {
            g.fillStyle = R() < 0.12 ? '#d8893a' : `rgb(${90 + R() * 40},${130 + R() * 50},${50 + R() * 30})`;
            g.beginPath(); g.arc(x + 2.5, y, 2.5 + R() * 1.5, 0, 7); g.fill();
          }
        }
      }
    }, false);
    TEX.quarry = makeTex(96, 96, (g, R) => {
      g.fillStyle = '#6e7277'; g.fillRect(0, 0, 96, 96);
      g.fillStyle = '#54585d'; g.fillRect(10, 10, 76, 76);
      g.fillStyle = '#44484d'; g.fillRect(22, 22, 52, 52);
      g.fillStyle = '#3a3e43'; g.fillRect(34, 34, 28, 28);
      speckle(g, 96, 96, 260, ['#8b9096', '#5d6166', '#75797e'], R, 3);
    }, false);
    TEX.garden = makeTex(64, 64, (g, R) => {
      g.fillStyle = '#41331f'; g.fillRect(0, 0, 64, 64);
      speckle(g, 64, 64, 120, ['#2f2516', '#52422a'], R);
    }, false);
    // soft puff for smoke / mist / clouds / foam
    TEX.puff = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      grd.addColorStop(0, 'rgba(255,255,255,0.85)');
      grd.addColorStop(0.55, 'rgba(255,255,255,0.32)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    // waterfall streaks (white over transparent)
    TEX.stream = (() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 128;
      const g = c.getContext('2d');
      const R = mulberry32(404);
      g.clearRect(0, 0, 64, 128);
      for (let i = 0; i < 90; i++) {
        const x = R() * 64, y = R() * 128, l = 14 + R() * 30;
        const a = 0.18 + R() * 0.4;
        const grd = g.createLinearGradient(0, y, 0, y + l);
        grd.addColorStop(0, `rgba(255,255,255,0)`);
        grd.addColorStop(0.5, `rgba(235,245,252,${a})`);
        grd.addColorStop(1, `rgba(255,255,255,0)`);
        g.strokeStyle = grd;
        g.lineWidth = 1.5 + R() * 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + R() * 2 - 1, y + l); g.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    })();
    // aurora ribbon gradient
    TEX.aurora = (() => {
      const c = document.createElement('canvas'); c.width = 16; c.height = 64;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 64, 0, 0);
      grd.addColorStop(0, 'rgba(60,235,160,0.55)');
      grd.addColorStop(0.35, 'rgba(70,210,190,0.30)');
      grd.addColorStop(0.8, 'rgba(120,140,235,0.10)');
      grd.addColorStop(1, 'rgba(120,140,235,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 16, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    // grass tuft (alpha-tested blades)
    TEX.tuft = (() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 48;
      const g = c.getContext('2d');
      const R = mulberry32(808);
      g.clearRect(0, 0, 64, 48);
      for (let i = 0; i < 26; i++) {
        const x = 6 + R() * 52;
        g.strokeStyle = `rgb(${70 + R() * 50},${115 + R() * 55},${45 + R() * 35})`;
        g.lineWidth = 1.6 + R();
        g.beginPath();
        g.moveTo(x, 48);
        g.quadraticCurveTo(x + (R() * 14 - 7), 26 + R() * 8, x + (R() * 20 - 10), 4 + R() * 14);
        g.stroke();
      }
      if (R() < 2) { // a couple of flower heads
        for (let i = 0; i < 3; i++) {
          g.fillStyle = ['#e6e2d2', '#e3c95c', '#7d92c9'][(R() * 3) | 0];
          g.beginPath(); g.arc(10 + R() * 44, 8 + R() * 10, 2, 0, 7); g.fill();
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    TEX.terrNoise = makeTex(64, 64, (g, R) => {
      g.fillStyle = '#9c9c9c'; g.fillRect(0, 0, 64, 64);
      speckle(g, 64, 64, 700, ['#8a8a8a', '#b0b0b0', '#787878'], R);
    });
    TEX.terrNoise.repeat.set(52, 40);

    MAT.plank = lam({ map: TEX.plank });
    MAT.log = lam({ map: TEX.log });
    MAT.logEnd = lam({ map: TEX.logEnd });
    MAT.plaster = lam({ map: TEX.plaster });
    MAT.shingle = lam({ map: TEX.shingle });
    MAT.sod = lam({ map: TEX.sod });
    MAT.stone = lam({ map: TEX.stone });
    MAT.bark = lam({ map: TEX.bark });
    MAT.darkWood = lam({ color: '#3a2c1a' });
    MAT.barrel = lam({ map: TEX.barrel });
    MAT.door = lam({ map: TEX.door });
    MAT.window = lam({ map: TEX.window, emissive: new THREE.Color('#ffb45e'), emissiveMap: TEX.windowGlow, emissiveIntensity: 0 });
    MAT.lantern = lam({ color: '#8a6c3a', emissive: new THREE.Color('#ffc06a'), emissiveIntensity: 0 });
    MAT.needles = lam({ vertexColors: true });
    MAT.leaves = lam({ vertexColors: true });
    // tinted variants for standalone (non-instanced) trees on the map
    MAT.leafyTints = ['#7fa04d', '#cf8f33', '#5d8a42'].map(col => lam({ vertexColors: true, color: col }));
    MAT.needleTints = ['#ffffff', '#d6e0c8', '#bccab2'].map(col => lam({ vertexColors: true, color: col }));
    MAT.sail = lam({ map: TEX.sail, side: THREE.DoubleSide });
    MAT.tuft = lam({ map: TEX.tuft, alphaTest: 0.35, side: THREE.DoubleSide });
  }

  // ---------- geometry helpers ----------
  function box(w, h, d, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function cyl(r, h, mat, rTop, seg = 9) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop ?? r, r, h, seg), mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  // swayback gable roof: ridge sags in the middle and kicks up at the ends
  function gableRoof(w, h, d, slopeMat = MAT.shingle, endMat = MAT.plank, over = 0.14, sag = 0.06, kick = 0.05) {
    const hw = w / 2 + over, hd = d / 2 + over, SEG = 6;
    const ridgeY = t => h * (1 - sag * Math.sin(Math.PI * t)) + h * kick * Math.pow(Math.abs(2 * t - 1), 4);
    const P = [], UV = [];
    const su = w * 1.6, sv = Math.hypot(h, hd) * 1.6;
    const tri = (a, b, c2, ua, ub, uc) => { P.push(...a, ...b, ...c2); UV.push(...ua, ...ub, ...uc); };
    for (let i = 0; i < SEG; i++) {
      const t0 = i / SEG, t1 = (i + 1) / SEG;
      const x0 = -hw + 2 * hw * t0, x1 = -hw + 2 * hw * t1;
      const y0 = ridgeY(t0), y1 = ridgeY(t1);
      // front slope (+z)
      tri([x0, 0, hd], [x1, 0, hd], [x1, y1, 0], [t0 * su, 0], [t1 * su, 0], [t1 * su, sv]);
      tri([x0, 0, hd], [x1, y1, 0], [x0, y0, 0], [t0 * su, 0], [t1 * su, sv], [t0 * su, sv]);
      // back slope (-z)
      tri([x1, 0, -hd], [x0, 0, -hd], [x0, y0, 0], [t1 * su, 0], [t0 * su, 0], [t0 * su, sv]);
      tri([x1, 0, -hd], [x0, y0, 0], [x1, y1, 0], [t1 * su, 0], [t0 * su, sv], [t1 * su, sv]);
    }
    const slopeCount = P.length / 3;
    // gable end triangles
    tri([-hw, 0, hd], [-hw, ridgeY(0), 0], [-hw, 0, -hd], [0, 0], [h, d / 2], [0, d]);
    tri([hw, 0, -hd], [hw, ridgeY(1), 0], [hw, 0, hd], [0, 0], [h, d / 2], [0, d]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.addGroup(0, slopeCount, 0);
    g.addGroup(slopeCount, 6, 1);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, [slopeMat, endMat]);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.peak = h * (1 + kick);
    return m;
  }
  function decal(w, h, mat) {
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  }
  function flatDecal(w, d, tex) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lam({ map: tex }));
    m.rotation.x = -Math.PI / 2;
    m.receiveShadow = true;
    return m;
  }
  function mergeWithColors(parts) {
    const pos = [], norm = [], col = [];
    const c = new THREE.Color();
    for (const [geo, matrix, color] of parts) {
      const g = geo.toNonIndexed();
      g.applyMatrix4(matrix);
      pos.push(...g.getAttribute('position').array);
      norm.push(...g.getAttribute('normal').array);
      c.set(color);
      const n = g.getAttribute('position').count;
      for (let i = 0; i < n; i++) col.push(c.r, c.g, c.b);
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
  }
  const M4 = (x, y, z, s = 1) => new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));

  // ---------- trees / rocks ----------
  let spruceGeo = null, leafyGeo = null, tuftGeo = null;
  function buildSharedGeos() {
    spruceGeo = mergeWithColors([
      [new THREE.CylinderGeometry(0.05, 0.08, 0.5, 6), M4(0, 0.25, 0), '#4f3d2a'],
      [new THREE.ConeGeometry(0.52, 0.95, 7), M4(0, 0.85, 0), '#2e4a28'],
      [new THREE.ConeGeometry(0.40, 0.85, 7), M4(0, 1.35, 0), '#35562e'],
      [new THREE.ConeGeometry(0.27, 0.75, 7), M4(0, 1.85, 0), '#3d6334'],
    ]);
    leafyGeo = mergeWithColors([
      [new THREE.CylinderGeometry(0.05, 0.08, 0.6, 6), M4(0, 0.3, 0), '#5d4a32'],
      [new THREE.IcosahedronGeometry(0.45, 1), M4(0, 0.85, 0, 1), '#ffffff'],
      [new THREE.IcosahedronGeometry(0.28, 1), M4(0.2, 1.1, 0.12, 1), '#f0f0f0'],
    ]);
    // criss-cross tuft quads
    const p1 = new THREE.PlaneGeometry(0.42, 0.3);
    p1.translate(0, 0.15, 0);
    const p2 = p1.clone();
    p2.rotateY(Math.PI / 2);
    const pos = [...p1.toNonIndexed().getAttribute('position').array, ...p2.toNonIndexed().getAttribute('position').array];
    const uv = [...p1.toNonIndexed().getAttribute('uv').array, ...p2.toNonIndexed().getAttribute('uv').array];
    const nor = [...p1.toNonIndexed().getAttribute('normal').array, ...p2.toNonIndexed().getAttribute('normal').array];
    tuftGeo = new THREE.BufferGeometry();
    tuftGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tuftGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    tuftGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  }
  function treeModel(variant) {
    const grp = new THREE.Group();
    if (variant % 3 !== 2) {
      const m = new THREE.Mesh(spruceGeo, MAT.needleTints[variant % MAT.needleTints.length]);
      m.castShadow = true; m.receiveShadow = true;
      m.scale.setScalar(0.85 + (variant % 5) * 0.09);
      grp.add(m);
    } else {
      const m = new THREE.Mesh(leafyGeo, MAT.leafyTints[variant % MAT.leafyTints.length]);
      m.castShadow = true; m.receiveShadow = true;
      m.scale.setScalar(0.8 + (variant % 4) * 0.08);
      grp.add(m);
    }
    return grp;
  }
  function rockModel(variant) {
    const grp = new THREE.Group();
    const r1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), MAT.stone);
    r1.position.y = 0.12; r1.scale.y = 0.6; r1.rotation.y = variant;
    r1.castShadow = true; r1.receiveShadow = true;
    const r2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), MAT.stone);
    r2.position.set(0.26, 0.07, 0.16); r2.scale.y = 0.55; r2.rotation.y = variant * 2.1;
    r2.castShadow = true; r2.receiveShadow = true;
    grp.add(r1, r2);
    return grp;
  }

  // ---------- building factories (per-instance character) ----------
  function addDoor(grp, x, y, z, ry = 0) {
    const d = decal(0.32, 0.46, MAT.door);
    d.position.set(x, y, z); d.rotation.y = ry;
    grp.add(d);
  }
  function addWindow(grp, x, y, z, ry = 0, s = 0.26) {
    const d = decal(s, s, MAT.window);
    d.position.set(x, y, z); d.rotation.y = ry;
    grp.add(d);
  }
  function addLantern(grp, x, y, z) {
    const arm = box(0.04, 0.04, 0.14, MAT.darkWood);
    arm.position.set(x, y + 0.12, z - 0.05);
    const lan = box(0.08, 0.11, 0.08, MAT.lantern);
    lan.position.set(x, y, z);
    grp.add(arm, lan);
  }
  function addHorns(grp, hw, peakY) {
    for (const sx of [-1, 1]) {
      const horn = box(0.06, 0.3, 0.06, MAT.darkWood);
      horn.position.set(sx * hw, peakY + 0.07, 0);
      horn.rotation.z = -sx * 0.55;
      grp.add(horn);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 5), MAT.darkWood);
      tip.position.set(sx * (hw + 0.10), peakY + 0.19, 0);
      tip.rotation.z = -sx * 0.8;
      tip.castShadow = true;
      grp.add(tip);
    }
  }
  function addLogEnds(grp, w, d, wallH) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const stub = cyl(0.05, 0.13, i % 2 ? MAT.logEnd : MAT.bark, 0.05, 6);
        stub.rotation.z = Math.PI / 2;
        if (i % 2) stub.rotation.x = Math.PI / 2;
        stub.position.set(sx * (w / 2 + 0.02), 0.18 + i * 0.2, sz * (d / 2 + 0.02));
        grp.add(stub);
      }
    }
  }
  function addFirewood(grp, x, z, ry, R) {
    const pile = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.24),
      [MAT.bark, MAT.bark, MAT.bark, MAT.bark, MAT.logEnd, MAT.logEnd]);
    pile.position.set(x, 0.15, z);
    pile.rotation.y = ry;
    pile.castShadow = true; pile.receiveShadow = true;
    grp.add(pile);
  }
  function addBarrel(grp, x, z) {
    const b = cyl(0.13, 0.32, MAT.barrel, 0.115);
    b.position.set(x, 0.16, z);
    grp.add(b);
  }
  function house(R, { w, d, wallH, roofH, wallMat, roofMat, chimney, windows, awning }) {
    const grp = new THREE.Group();
    const wall = box(w, wallH, d, wallMat);
    wall.position.y = wallH / 2;
    grp.add(wall);
    const found = box(w + 0.06, 0.12, d + 0.06, MAT.stone);
    found.position.y = 0.06;
    grp.add(found);
    const sag = 0.04 + R() * 0.06, kick = 0.03 + R() * 0.05;
    const roof = gableRoof(w, roofH, d, roofMat, wallMat, 0.16, sag, kick);
    roof.position.y = wallH;
    grp.add(roof);
    const peakY = wallH + roof.userData.peak;
    if (chimney) {
      const ch = box(0.16, roofH + 0.42, 0.16, MAT.stone);
      ch.position.set(w * 0.26, wallH + (roofH + 0.42) / 2 - 0.1, -d * 0.12);
      grp.add(ch);
      grp.userData.smoke = new THREE.Vector3(w * 0.26, wallH + roofH + 0.4, -d * 0.12);
    }
    const doorX = (R() < 0.5 ? -1 : 1) * (R() < 0.4 ? 0.3 : 0);
    addDoor(grp, doorX, 0.24, d / 2 + 0.012);
    addLantern(grp, doorX + 0.3, 0.5, d / 2 + 0.05);
    for (const [wx, wy, wz, ry] of windows || []) addWindow(grp, wx, wy, wz, ry);
    if (wallMat === MAT.log) addLogEnds(grp, w, d, wallH);
    if (R() < 0.45) addHorns(grp, w / 2 + 0.16, peakY);
    if (awning) {
      const awn = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.34), MAT.sail);
      awn.position.set(doorX === 0 ? 0.5 : -doorX * 0.5, 0.6, d / 2 + 0.16);
      awn.rotation.x = -0.7;
      awn.castShadow = true;
      grp.add(awn);
    }
    // yard clutter
    const side = R() < 0.5 ? -1 : 1;
    if (R() < 0.6) addFirewood(grp, side * (w / 2 + 0.18), d * 0.1, Math.PI / 2 + (R() - 0.5) * 0.3, R);
    if (R() < 0.4) addBarrel(grp, -side * (w / 2 + 0.16), d * 0.3);
    grp.rotation.y = (R() - 0.5) * 0.045;
    grp.userData.peak = peakY;
    return grp;
  }
  const FACT = {
    cottage(seed) {
      const R = mulberry32(seed);
      const wp = R();
      const wallMat = wp < 0.4 ? MAT.log : wp < 0.78 ? MAT.plank : MAT.plaster;
      const roofMat = R() < 0.38 ? MAT.sod : MAT.shingle;
      const wallH = 0.68 + R() * 0.1;
      return house(R, {
        w: 1.62, d: 1.38, wallH, roofH: 0.55 + R() * 0.16, wallMat, roofMat, chimney: true,
        windows: [[-0.5, wallH * 0.58, 1.38 / 2 + 0.012, 0], [0.5, wallH * 0.58, 1.38 / 2 + 0.012, 0],
                  [-1.62 / 2 - 0.012, wallH * 0.58, 0, -Math.PI / 2]],
      });
    },
    bakery(seed) {
      const R = mulberry32(seed);
      const g = house(R, {
        w: 1.62, d: 1.38, wallH: 0.78, roofH: 0.6, wallMat: MAT.plaster,
        roofMat: R() < 0.3 ? MAT.sod : MAT.shingle, chimney: true, awning: true,
        windows: [[-0.5, 0.46, 1.38 / 2 + 0.012, 0]],
      });
      return g;
    },
    manor(seed) {
      const R = mulberry32(seed);
      const grp = house(R, {
        w: 2.5, d: 1.6, wallH: 1.0, roofH: 0.85, wallMat: R() < 0.5 ? MAT.plank : MAT.log,
        roofMat: R() < 0.4 ? MAT.sod : MAT.shingle, chimney: true,
        windows: [[-0.8, 0.6, 0.8 + 0.012, 0], [0.8, 0.6, 0.8 + 0.012, 0],
                  [-0.8, 0.6, -0.8 - 0.012, Math.PI], [0.8, 0.6, -0.8 - 0.012, Math.PI]],
      });
      addHorns(grp, 2.5 / 2 + 0.18, grp.userData.peak);
      const wing = box(1.0, 0.9, 1.5, MAT.plank);
      wing.position.set(-0.6, 0.45, 0.55);
      grp.add(wing);
      const wingRoof = gableRoof(1.5, 0.6, 1.0, MAT.shingle, MAT.plank, 0.12, 0.12, 0.1);
      wingRoof.rotation.y = Math.PI / 2;
      wingRoof.position.set(-0.6, 0.9, 0.55);
      grp.add(wingRoof);
      addWindow(grp, -0.6, 0.55, 1.3 + 0.012, 0, 0.3);
      // banner pole with pennant
      const pole = cyl(0.025, 1.6, MAT.darkWood);
      pole.position.set(1.15, 0.8, 1.05);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.2), lam({ color: '#a8392c', side: THREE.DoubleSide }));
      flag.position.set(1.37, 1.5, 1.05);
      flag.castShadow = true;
      grp.add(pole, flag);
      const hedgeMat = lam({ color: '#46663a' });
      for (const hx of [0.55, 0.95]) {
        const h = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), hedgeMat);
        h.position.set(hx, 0.14, 1.0); h.castShadow = true;
        grp.add(h);
      }
      return grp;
    },
    farm(seed) {
      const R = mulberry32(seed);
      const grp = new THREE.Group();
      const f = flatDecal(2.85, 2.85, TEX.field);
      f.position.y = 0.02;
      f.rotation.z = R() < 0.5 ? 0 : Math.PI / 2;
      grp.add(f);
      for (const [x, z, rl, ry] of [[0, -1.45, 2.95, 0], [0, 1.45, 2.95, 0], [-1.45, 0, 2.95, Math.PI / 2], [1.45, 0, 2.95, Math.PI / 2]]) {
        const rail = box(rl, 0.05, 0.05, MAT.bark);
        rail.position.set(x, 0.34, z); rail.rotation.y = ry;
        grp.add(rail);
      }
      for (const px2 of [-1.45, 0, 1.45]) for (const pz of [-1.45, 1.45]) {
        const post = box(0.07, 0.5, 0.07, MAT.bark);
        post.position.set(px2, 0.25, pz);
        grp.add(post);
      }
      // windmill in a corner
      const mx = R() < 0.5 ? -0.95 : 0.95;
      const tower = cyl(0.18, 1.3, MAT.plank, 0.13, 7);
      tower.position.set(mx, 0.65, -0.95);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.25, 7), MAT.shingle);
      cap.position.set(mx, 1.42, -0.95);
      cap.castShadow = true;
      const hub = new THREE.Group();
      hub.position.set(mx, 1.25, -0.95 + 0.2);
      for (let i = 0; i < 4; i++) {
        const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.62), MAT.sail);
        blade.position.y = 0.34;
        blade.castShadow = true;
        const arm = new THREE.Group();
        arm.rotation.z = i * Math.PI / 2;
        arm.add(blade);
        hub.add(arm);
      }
      hub.rotation.x = 0.1;
      grp.add(tower, cap, hub);
      windmills.push(hub);
      // haystack
      const hay = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 8), lam({ color: '#c2a154' }));
      hay.position.set(-mx, 0.25, 0.9);
      hay.castShadow = true; hay.receiveShadow = true;
      grp.add(hay);
      // scarecrow
      const pole = cyl(0.03, 0.7, MAT.bark);
      pole.position.set(0.45, 0.35, 0.35);
      const arm2 = box(0.5, 0.05, 0.05, MAT.bark);
      arm2.position.set(0.45, 0.52, 0.35);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 6), lam({ color: '#d8b95c' }));
      head.castShadow = true;
      head.position.set(0.45, 0.68, 0.35);
      grp.add(pole, arm2, head);
      return grp;
    },
    lumber(seed) {
      const R = mulberry32(seed);
      const grp = new THREE.Group();
      const mkLog = (x, y, z) => {
        const l = cyl(0.12, 1.05, MAT.bark);
        l.rotation.z = Math.PI / 2;
        l.position.set(x, y, z);
        return l;
      };
      grp.add(mkLog(-0.3, 0.12, 0.4), mkLog(-0.3, 0.12, 0.66), mkLog(-0.3, 0.33, 0.53));
      for (const sx of [-0.75, 0.15]) for (const sz of [-0.6, 0.05]) {
        const post = box(0.07, 0.8, 0.07, MAT.bark);
        post.position.set(sx, 0.4, sz);
        grp.add(post);
      }
      const shRoof = gableRoof(1.0, 0.3, 0.75, MAT.sod, MAT.plank, 0.1, 0.1, 0.1);
      shRoof.position.set(-0.3, 0.8, -0.28);
      grp.add(shRoof);
      const planks = box(0.65, 0.18, 0.4, MAT.plank);
      planks.position.set(-0.3, 0.09, -0.3);
      grp.add(planks);
      addFirewood(grp, 0.6, -0.45, 0.2 + R() * 0.3, R);
      const stump = cyl(0.16, 0.22, MAT.bark);
      stump.position.set(0.55, 0.11, 0.35);
      grp.add(stump);
      const axeH = box(0.04, 0.38, 0.04, MAT.bark);
      axeH.position.set(0.55, 0.38, 0.35); axeH.rotation.z = 0.4;
      const axeB = box(0.15, 0.08, 0.03, MAT.stone);
      axeB.position.set(0.48, 0.52, 0.35);
      grp.add(axeH, axeB);
      return grp;
    },
    quarry(seed) {
      const R = mulberry32(seed);
      const grp = new THREE.Group();
      const f = flatDecal(1.88, 1.88, TEX.quarry);
      f.position.y = 0.02;
      grp.add(f);
      const b1 = box(0.34, 0.26, 0.3, MAT.stone);
      b1.position.set(-0.4, 0.13, 0.42);
      const b2 = box(0.26, 0.2, 0.24, MAT.stone);
      b2.position.set(0.45, 0.1, -0.35); b2.rotation.y = 0.5;
      grp.add(b1, b2);
      const legA = box(0.06, 1.0, 0.06, MAT.bark); legA.position.set(0.35, 0.48, 0.4); legA.rotation.z = -0.35;
      const legB = box(0.06, 1.0, 0.06, MAT.bark); legB.position.set(0.75, 0.48, 0.4); legB.rotation.z = 0.35;
      const beam = box(0.9, 0.05, 0.05, MAT.bark); beam.position.set(0.55, 0.92, 0.4);
      grp.add(legA, legB, beam);
      addLantern(grp, -0.7, 0.42, 0.85);
      const lpost = box(0.05, 0.55, 0.05, MAT.darkWood);
      lpost.position.set(-0.7, 0.28, 0.9);
      grp.add(lpost);
      return grp;
    },
    well(seed) {
      const R = mulberry32(seed);
      const grp = new THREE.Group();
      const ring = cyl(0.28, 0.32, MAT.stone, 0.26, 10);
      ring.position.y = 0.16;
      grp.add(ring);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.19, 10), lam({ color: '#15181e' }));
      hole.rotation.x = -Math.PI / 2;
      hole.position.y = 0.325;
      grp.add(hole);
      const p1 = box(0.05, 0.6, 0.05, MAT.bark); p1.position.set(-0.26, 0.5, 0);
      const p2 = p1.clone(); p2.position.x = 0.26;
      grp.add(p1, p2);
      const roof = gableRoof(0.72, 0.28, 0.5, MAT.sod, MAT.plank, 0.06, 0.14, 0.12);
      roof.position.y = 0.8;
      grp.add(roof);
      const bucket = cyl(0.07, 0.1, MAT.barrel, 0.06);
      bucket.position.y = 0.52;
      grp.add(bucket);
      return grp;
    },
    garden(seed) {
      const R = mulberry32(seed);
      const grp = new THREE.Group();
      const rim = box(0.94, 0.09, 0.94, MAT.bark);
      rim.position.y = 0.045;
      grp.add(rim);
      const bed = flatDecal(0.8, 0.8, TEX.garden);
      bed.position.y = 0.095;
      grp.add(bed);
      const cols = ['#c84a3c', '#d8b95c', '#b66a9e', '#e6e2d2', '#7d92c9'];
      for (let i = 0; i < 9; i++) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), lam({ color: cols[(R() * cols.length) | 0] }));
        fl.position.set(-0.28 + (i % 3) * 0.28, 0.16 + R() * 0.05, -0.28 + ((i / 3) | 0) * 0.28);
        fl.castShadow = true;
        const stem = cyl(0.012, 0.1, lam({ color: '#3d6334' }), 0.012, 5);
        stem.position.set(fl.position.x, 0.1, fl.position.z);
        grp.add(stem, fl);
      }
      return grp;
    },
    market(seed) {
      const R = mulberry32(seed);
      const grp = new THREE.Group();
      const stall = (x, cloth) => {
        const s = new THREE.Group();
        const counter = box(1.1, 0.42, 0.58, MAT.plank);
        counter.position.y = 0.21;
        s.add(counter);
        for (const sx of [-0.5, 0.5]) for (const sz of [-0.24, 0.24]) {
          const post = box(0.05, 1.0, 0.05, MAT.bark);
          post.position.set(sx, 0.5, sz);
          s.add(post);
        }
        const roof = gableRoof(1.15, 0.3, 0.7, cloth ? MAT.sail : MAT.sod, MAT.plank, 0.1, 0.16, 0.06);
        roof.position.y = 1.0;
        s.add(roof);
        for (let i = 0; i < 4; i++) {
          const g = box(0.1, 0.1, 0.1, lam({ color: ['#c84a3c', '#d8b95c', '#cf7d3a', '#7da45a'][i] }));
          g.position.set(-0.36 + i * 0.24, 0.47, 0.08 + R() * 0.1);
          s.add(g);
        }
        s.position.x = x;
        return s;
      };
      grp.add(stall(-0.72, true), stall(0.72, false));
      // bunting between the stalls
      for (let i = 0; i < 5; i++) {
        const pn = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12),
          lam({ color: ['#c84a3c', '#d8b95c', '#7d92c9', '#7da45a', '#b66a9e'][i], side: THREE.DoubleSide }));
        pn.position.set(-0.5 + i * 0.25, 1.18 - Math.sin((i / 4) * Math.PI) * 0.1, 0.42);
        pn.rotation.z = Math.PI / 4;
        grp.add(pn);
      }
      const crate = box(0.32, 0.32, 0.32, MAT.plank);
      crate.position.set(-0.5, 0.16, 1.0);
      const crate2 = crate.clone();
      crate2.position.set(-0.14, 0.13, 1.05); crate2.rotation.y = 0.4; crate2.scale.setScalar(0.85);
      grp.add(crate, crate2);
      for (let i = 0; i < 3; i++) {
        const barrel = cyl(0.17, 0.42, MAT.barrel, 0.15);
        barrel.position.set(0.45 + (i % 2) * 0.38, i < 2 ? 0.21 : 0.6, 1.0);
        if (i === 2) barrel.position.x = 0.64;
        grp.add(barrel);
      }
      addLantern(grp, -1.28, 0.7, 0.3);
      const lpost = box(0.05, 0.85, 0.05, MAT.darkWood);
      lpost.position.set(-1.28, 0.43, 0.35);
      grp.add(lpost);
      return grp;
    },
  };
  function buildModels() {
    const M = {};
    for (const k in FACT) M[k] = FACT[k](1);
    return M;
  }
  function makeGhosts() {
    const ok = lam({ color: '#6edc5a', transparent: true, opacity: 0.5 });
    const bad = lam({ color: '#dc4632', transparent: true, opacity: 0.5 });
    const out = {};
    for (const k in models) {
      const gOk = models[k].clone(true), gBad = models[k].clone(true);
      gOk.traverse(o => { if (o.isMesh) { o.material = ok; o.castShadow = false; o.receiveShadow = false; } });
      gBad.traverse(o => { if (o.isMesh) { o.material = bad; o.castShadow = false; o.receiveShadow = false; } });
      out[k] = { ok: gOk, bad: gBad };
    }
    return out;
  }

  // ---------- the valley ----------
  const WATER_Y = -0.34, SK = 44;
  function terrainH(x, z) {
    const dx = Math.max(0, Math.abs(x) - COLS / 2 - 0.5);
    const dz = Math.max(0, Math.abs(z) - ROWS / 2 - 0.5);
    const d = Math.hypot(dx, dz);
    if (d <= 0) return -0.05;
    const m = Math.pow(Math.min(1, d / 26), 1.6);
    const rn = fbm(x * 0.045 + 7, z * 0.045 + 3);
    const rg = ridged(x * 0.022 + 19, z * 0.022 + 5);
    let h = m * (7 + 12 * rn + 21 * rg * m);
    h += sstep(0, 3, d) * (fbm(x * 0.3, z * 0.3) - 0.5) * 1.2;
    const depth = -(z + ROWS / 2);
    if (depth > 0) {
      const cx = 3 + Math.sin(depth * 0.12) * 4;
      const half = 4.5 + depth * 0.6;
      const f = Math.max(0, 1 - Math.abs(x - cx) / half);
      h -= sstep(0, 5, depth) * f * f * (h + 2.5);
    }
    return h;
  }
  function buildValley() {
    const w = COLS + SK * 2, d = ROWS + SK * 2;
    const geo = new THREE.PlaneGeometry(w, d, Math.round(w * 1.15), Math.round(d * 1.15));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(), rock = new THREE.Color('#74797f'), snow = new THREE.Color('#e8edf2'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainH(x, z);
      pos.setY(i, h);
      const e = 0.7;
      const sl = Math.hypot(terrainH(x + e, z) - terrainH(x - e, z), terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
      const n = fbm(x * 0.2 + 31, z * 0.2 + 17);
      grass.setRGB(0.34 + n * 0.15, 0.46 + n * 0.15, 0.24 + n * 0.10);
      c.copy(grass).lerp(rock, sstep(0.42, 0.95, sl + n * 0.18));
      // snowline with noisy edge, less snow on cliffs
      const snowA = sstep(11.5 + n * 4, 15 + n * 4, h) * (1 - sstep(1.0, 1.6, sl));
      c.lerp(snow, snowA);
      if (h < WATER_Y + 0.3) c.lerp(new THREE.Color('#564f42'), 0.65);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, lam({ vertexColors: true, map: TEX.terrNoise }));
    mesh.position.y = -0.06;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // instanced forest: spruces + autumn/leafy accents
    const R = mulberry32(987654);
    const spruces = [], leafies = [];
    for (let i = 0; i < 4200 && spruces.length < 520; i++) {
      const x = (R() * 2 - 1) * (COLS / 2 + SK - 2);
      const z = (R() * 2 - 1) * (ROWS / 2 + SK - 2);
      if (Math.abs(x) < COLS / 2 + 1.5 && Math.abs(z) < ROWS / 2 + 1.5) continue;
      const h = terrainH(x, z);
      if (h < 0.25 || h > 13.5) continue; // treeline
      const e = 0.7;
      const sl = Math.hypot(terrainH(x + e, z) - terrainH(x - e, z), terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
      if (sl > 0.85) continue;
      const rec = { x, z, h, s: 1.0 + R() * 1.5, r: R() * 6.3 };
      if (R() < 0.16 && h < 6) leafies.push(rec); else spruces.push(rec);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    const tint = new THREE.Color();
    const forest = new THREE.InstancedMesh(spruceGeo, MAT.needles, spruces.length);
    spruces.forEach((p, i) => {
      q.setFromAxisAngle(up, p.r);
      sc.setScalar(p.s);
      m4.compose(new THREE.Vector3(p.x, p.h - 0.1, p.z), q, sc);
      forest.setMatrixAt(i, m4);
      const t = 0.74 + (vhash(i, 7) * 0.5);
      tint.setRGB(t, t + 0.05, t);
      forest.setColorAt(i, tint);
    });
    forest.castShadow = true; forest.receiveShadow = true;
    scene.add(forest);
    const autumnCols = ['#cf8f33', '#b86a2c', '#9f4f28', '#7fa04d', '#c9b03d'];
    const grove = new THREE.InstancedMesh(leafyGeo, MAT.leaves, leafies.length);
    leafies.forEach((p, i) => {
      q.setFromAxisAngle(up, p.r);
      sc.setScalar(p.s * 0.85);
      m4.compose(new THREE.Vector3(p.x, p.h - 0.1, p.z), q, sc);
      grove.setMatrixAt(i, m4);
      tint.set(autumnCols[(vhash(i, 13) * autumnCols.length) | 0]);
      grove.setColorAt(i, tint);
    });
    grove.castShadow = true; grove.receiveShadow = true;
    scene.add(grove);

    // fjord water with depth gradient toward the horizon
    const wseg = 1;
    const wgeo = new THREE.PlaneGeometry(190, 130, wseg, 24);
    wgeo.rotateX(-Math.PI / 2);
    const wpos = wgeo.getAttribute('position');
    const wcol = new Float32Array(wpos.count * 3);
    const near = new THREE.Color('#2f5868'), far = new THREE.Color('#a7c8d8');
    for (let i = 0; i < wpos.count; i++) {
      const t = clamp((-(wpos.getZ(i)) - 10) / 100, 0, 1);
      c.copy(near).lerp(far, t * t);
      wcol[i * 3] = c.r; wcol[i * 3 + 1] = c.g; wcol[i * 3 + 2] = c.b;
    }
    wgeo.setAttribute('color', new THREE.BufferAttribute(wcol, 3));
    const wtex = makeTex(128, 128, (g, Rr) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 240; i++) {
        g.strokeStyle = `rgba(${200 + Rr() * 40},${225 + Rr() * 25},${235 + Rr() * 20},${0.10 + Rr() * 0.14})`;
        const x = Rr() * 128, y = Rr() * 128;
        g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 8, y + 1, x + 16, y - 1, x + 22 + Rr() * 10, y);
        g.stroke();
      }
    });
    wtex.repeat.set(9, 7);
    water = new THREE.Mesh(wgeo, new THREE.MeshPhongMaterial({
      map: wtex, vertexColors: true, color: '#9db8c2', specular: '#eaf6fc', shininess: 120,
      transparent: true, opacity: 0.96,
    }));
    water.position.set(0, WATER_Y, -(ROWS / 2) - 24);
    scene.add(water);

    buildWaterfall();

    // longboat
    boat = (() => {
      const grp = new THREE.Group();
      const hull = box(1.5, 0.22, 0.42, MAT.plank);
      hull.position.y = 0.1;
      const bow = box(0.3, 0.34, 0.3, MAT.plank);
      bow.position.set(0.75, 0.16, 0); bow.rotation.z = 0.5;
      const stern = bow.clone(); stern.position.x = -0.75; stern.rotation.z = -0.5;
      const mast = cyl(0.03, 1.15, MAT.bark);
      mast.position.y = 0.75;
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.62), MAT.sail);
      sail.position.set(0, 0.85, 0.02);
      sail.castShadow = true;
      grp.add(hull, bow, stern, mast, sail);
      grp.position.set(-20, WATER_Y, -(ROWS / 2) - 12);
      scene.add(grp);
      return grp;
    })();

    // mist banks over the fjord
    for (let i = 0; i < 8; i++) {
      const sm = new THREE.SpriteMaterial({ map: TEX.puff, color: '#e8eef2', transparent: true, opacity: 0.10, depthWrite: false });
      const s = new THREE.Sprite(sm);
      const mx = -28 + i * 8 + (i % 2) * 4;
      s.position.set(mx, 0.8 + (i % 3) * 0.6, -(ROWS / 2) - 4 - (i % 4) * 6);
      s.scale.set(16 + (i % 3) * 7, 4.5, 1);
      s.userData = { bx: mx, ph: i * 1.7 };
      scene.add(s);
      mists.push(s);
    }

    // clouds
    for (let i = 0; i < 9; i++) {
      const grp = new THREE.Group();
      const n = 3 + (i % 3);
      for (let j = 0; j < n; j++) {
        const sm = new THREE.SpriteMaterial({ map: TEX.puff, color: '#ffffff', transparent: true, opacity: 0.34, depthWrite: false });
        const s = new THREE.Sprite(sm);
        s.position.set(j * 3.2 - n * 1.6 + vhash(i, j) * 2, vhash(j, i) * 1.4, vhash(i * 3, j) * 2);
        const sc2 = 6 + vhash(i, j * 7) * 6;
        s.scale.set(sc2, sc2 * 0.42, 1);
        grp.add(s);
      }
      grp.position.set(-80 + i * 19, 22 + (i % 4) * 2.5, -36 + (i % 5) * 14);
      grp.userData = { sp: 0.25 + (i % 3) * 0.1 };
      scene.add(grp);
      clouds.push(grp);
    }

    // aurora ribbons (visible at night)
    for (let i = 0; i < 2; i++) {
      const ag = new THREE.PlaneGeometry(86, 10 + i * 4, 48, 1);
      const am = new THREE.MeshBasicMaterial({
        map: TEX.aurora, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      });
      const a = new THREE.Mesh(ag, am);
      a.position.set(i * 14 - 6, 22 + i * 5, -(ROWS / 2) - 38 - i * 8);
      a.userData = { ph: i * 2.4, base: ag.getAttribute('position').array.slice() };
      scene.add(a);
      auroras.push(a);
    }

    // motes by day, fireflies by night
    for (let i = 0; i < 16; i++) {
      const sm = new THREE.SpriteMaterial({ map: TEX.puff, color: '#fff6da', transparent: true, opacity: 0.18, depthWrite: false });
      const s = new THREE.Sprite(sm);
      s.userData = {
        bx: (vhash(i, 3) * 2 - 1) * COLS * 0.45,
        bz: (vhash(i, 9) * 2 - 1) * ROWS * 0.45,
        by: 0.6 + vhash(i, 5) * 1.6, ph: i * 1.37,
      };
      s.scale.set(0.12, 0.12, 1);
      scene.add(s);
      motes.push(s);
    }

    // chimney smoke pool
    for (let i = 0; i < 36; i++) {
      const sm = new THREE.SpriteMaterial({ map: TEX.puff, color: '#d8d4cc', transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(sm);
      s.visible = false;
      s.userData = { life: 0, max: 1 };
      scene.add(s);
      smokePool.push(s);
    }
  }
  // find the steepest cliff face beside the fjord and hang a waterfall on it
  function buildWaterfall() {
    let best = null;
    for (let z = -(ROWS / 2) - 3; z > -(ROWS / 2) - 26; z -= 0.5) {
      for (let x = -24; x < 28; x += 0.5) {
        if (terrainH(x, z) > WATER_Y) continue; // need water here
        for (const [ox, oz] of [[2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]]) {
          const ht = terrainH(x + ox, z + oz);
          if (ht > 5 && (!best || ht > best.h)) best = { x, z, h: Math.min(ht, 11), dx: ox, dz: oz };
        }
      }
    }
    if (!best) return;
    const grp = new THREE.Group();
    const drop = best.h - WATER_Y;
    const dir = Math.atan2(-best.dx, -best.dz); // face away from cliff
    for (let i = 0; i < 2; i++) {
      const tex = i ? TEX.stream.clone() : TEX.stream;
      tex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true,
        opacity: i ? 0.5 : 0.85, depthWrite: false, side: THREE.DoubleSide,
      });
      mat.map.repeat.set(1, drop / 4);
      mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.7 - i * 0.4, drop), mat);
      plane.position.set(0, drop / 2, i * 0.22);
      plane.rotation.x = 0.06;
      grp.add(plane);
    }
    // foam at the base
    for (let i = 0; i < 3; i++) {
      const fm = new THREE.SpriteMaterial({ map: TEX.puff, color: '#f2f8fb', transparent: true, opacity: 0.4, depthWrite: false });
      const f = new THREE.Sprite(fm);
      f.position.set((i - 1) * 0.6, 0.3, 0.3);
      f.scale.set(1.6, 0.9, 1);
      f.userData = { ph: i * 2.1 };
      grp.add(f);
    }
    grp.position.set(best.x + best.dx * 0.55, WATER_Y, best.z + best.dz * 0.55);
    grp.rotation.y = dir;
    scene.add(grp);
    waterfall = grp;
  }

  // ---------- sky ----------
  function buildSky() {
    skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color('#5e93c0') },
        bottom: { value: new THREE.Color('#d6e6ee') },
        night: { value: 0 },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunCol: { value: new THREE.Color('#ffd9a0') },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `
        varying vec3 vP;
        uniform vec3 top, bottom, sunCol, sunDir;
        uniform float night;
        void main(){
          vec3 dir = normalize(vP);
          float t = pow(max(dir.y, 0.0), 0.5);
          vec3 col = mix(bottom, top, t);
          float sd = max(dot(dir, sunDir), 0.0);
          col += sunCol * pow(sd, 18.0) * (1.0 - night) * 0.55;       // halo
          col += sunCol * smoothstep(0.99955, 0.99985, sd) * (1.0 - night) * 1.6; // disc
          vec3 moonDir = normalize(vec3(-sunDir.x, abs(sunDir.y) * 0.7 + 0.25, -sunDir.z));
          float md = max(dot(dir, moonDir), 0.0);
          col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99965, 0.99992, md) * night * 1.2;
          col += vec3(0.5, 0.6, 0.8) * pow(md, 64.0) * night * 0.10;
          vec3 sp = floor(dir * 220.0);
          float hsh = fract(sin(dot(sp, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float star = step(0.9988, hsh) * night * smoothstep(0.02, 0.2, dir.y);
          col += vec3(star * 0.85);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(230, 24, 14), skyMat);
    scene.add(dome);
  }

  // ---------- playable ground ----------
  const PXT = 24;
  function paintGroundCanvas() {
    const g = groundCtx, R = mulberry32(8311);
    const tileCol = (x, y) => {
      const t = state.terrain[y][x];
      const n = fbm(x * 0.3, y * 0.3);
      if (t === T_PATH) return `rgb(${118 + n * 18 | 0},${98 + n * 14 | 0},${72 + n * 10 | 0})`;
      if (t === T_GRASS || t === T_TREE || t === T_ROCK)
        return `rgb(${80 + n * 26 | 0},${120 + n * 26 | 0},${54 + n * 18 | 0})`;
      return `rgb(${98 + n * 20 | 0},${119 + n * 22 | 0},${64 + n * 16 | 0})`;
    };
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      g.fillStyle = tileCol(x, y);
      g.fillRect(x * PXT, y * PXT, PXT, PXT);
    }
    g.globalAlpha = 0.3;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      g.fillStyle = tileCol(x, y);
      for (let i = 0; i < 2; i++) {
        g.beginPath();
        g.arc((x + 0.5) * PXT + (R() - 0.5) * PXT, (y + 0.5) * PXT + (R() - 0.5) * PXT,
          PXT * (0.3 + R() * 0.25), 0, 7);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    // worn earth around buildings
    if (typeof state !== 'undefined' && state.buildings) {
      for (const b of state.buildings) {
        const def = DEFS[b.type];
        g.fillStyle = 'rgba(122,100,70,0.5)';
        g.beginPath();
        g.ellipse((b.x + def.w / 2) * PXT, (b.y + def.h / 2) * PXT,
          (def.w / 2 + 0.45) * PXT, (def.h / 2 + 0.45) * PXT, 0, 0, 7);
        g.fill();
      }
    }
    // speckle
    for (let i = 0; i < COLS * ROWS * 9; i++) {
      const x = R() * COLS * PXT, y = R() * ROWS * PXT;
      g.fillStyle = R() < 0.5 ? 'rgba(40,60,25,0.18)' : 'rgba(225,235,190,0.13)';
      g.fillRect(x, y, 1.5, 1.5);
    }
    // wildflower clumps + path stones
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = state.terrain[y][x];
      if ((t === T_GRASS) && hash2(x, y) % 3 === 0) {
        const fr = mulberry32(hash2(x, y));
        const cols = ['#e6e2d2', '#e3c95c', '#7d92c9', '#c87f9e', '#d86a4a'];
        const cx = x * PXT + 5 + fr() * (PXT - 10), cy = y * PXT + 5 + fr() * (PXT - 10);
        const col = cols[(fr() * cols.length) | 0];
        for (let i = 0; i < 5; i++) {
          g.fillStyle = col;
          g.beginPath();
          g.arc(cx + (fr() - 0.5) * 6, cy + (fr() - 0.5) * 6, 1 + fr() * 0.8, 0, 7);
          g.fill();
        }
      }
      if (t === T_PATH) {
        const fr = mulberry32(hash2(x, y) ^ 77);
        for (let i = 0; i < 5; i++) {
          const v = 120 + fr() * 50;
          g.fillStyle = `rgba(${v},${v},${v - 8},0.55)`;
          g.beginPath();
          g.ellipse(x * PXT + 3 + fr() * (PXT - 6), y * PXT + 3 + fr() * (PXT - 6), 2 + fr() * 2, 1.5 + fr() * 1.5, fr() * 3, 0, 7);
          g.fill();
        }
      }
    }
  }
  const TUFT_MAX = 320;
  function rebuildTufts() {
    if (!tufts) {
      tufts = new THREE.InstancedMesh(tuftGeo, MAT.tuft, TUFT_MAX);
      tufts.receiveShadow = true;
      scene.add(tufts);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    const tint = new THREE.Color();
    let n = 0;
    for (let y = 0; y < ROWS && n < TUFT_MAX; y++) for (let x = 0; x < COLS && n < TUFT_MAX; x++) {
      if (state.terrain[y][x] !== T_GRASS) continue;
      if (occ.length && occ[y] && occ[y][x]) continue;
      const h = hash2(x, y);
      if (h % 5 > 2) continue;
      const r = mulberry32(h);
      const count = 1 + (h % 2);
      for (let i = 0; i < count && n < TUFT_MAX; i++) {
        q.setFromAxisAngle(up, r() * 6.3);
        sc.setScalar(0.7 + r() * 0.7);
        m4.compose(new THREE.Vector3(x - COLS / 2 + 0.2 + r() * 0.6, 0, y - ROWS / 2 + 0.2 + r() * 0.6), q, sc);
        tufts.setMatrixAt(n, m4);
        const t = 0.55 + r() * 0.35;
        tint.setRGB(t, t + 0.06, t * 0.85);
        tufts.setColorAt(n, tint);
        n++;
      }
    }
    tufts.count = n;
    tufts.instanceMatrix.needsUpdate = true;
    if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
  }
  function rebuildTerrain() {
    paintGroundCanvas();
    groundTex.needsUpdate = true;
    rebuildTufts();
    scatterGroup.clear();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = state.terrain[y][x], h = hash2(x, y);
      if (t !== T_TREE && t !== T_ROCK) continue;
      const m = t === T_TREE ? treeModel(h % 6) : rockModel((h % 7) * 0.9);
      m.position.copy(tileToWorld(x, y));
      m.rotation.y = (h % 13) * 0.48;
      scatterGroup.add(m);
    }
  }

  // ---------- buildings sync ----------
  function tileToWorld(tx, ty, w = 1, h = 1) {
    return new THREE.Vector3(tx + w / 2 - COLS / 2, 0, ty + h / 2 - ROWS / 2);
  }
  function syncBuildings() {
    const seen = new Set();
    let dirty = false;
    for (const b of state.buildings) {
      seen.add(b);
      if (!meshByBuilding.has(b)) {
        const def = DEFS[b.type];
        const m = FACT[b.type](hash2(b.x * 7 + 13, b.y * 5 + 29) || 1);
        m.position.copy(tileToWorld(b.x, b.y, def.w, def.h));
        buildingGroup.add(m);
        meshByBuilding.set(b, m);
        dirty = true;
      }
    }
    for (const [b, m] of meshByBuilding) {
      if (!seen.has(b)) { buildingGroup.remove(m); meshByBuilding.delete(b); dirty = true; }
    }
    if (dirty) {
      smokeEmitters = [];
      for (const [b, m] of meshByBuilding) {
        if (m.userData.smoke) smokeEmitters.push(new THREE.Vector3().copy(m.userData.smoke).add(m.position));
      }
      windmills = windmills.filter(o => { let p = o; while (p.parent) p = p.parent; return p === scene; });
      paintGroundCanvas();
      groundTex.needsUpdate = true;
      rebuildTufts();
    }
  }

  // ---------- previews ----------
  let curGhost = null;
  function setPreview(type, tx, ty, ok) {
    if (curGhost) { scene.remove(curGhost); curGhost = null; }
    if (!type || tx < 0) { previewTiles.visible = false; return; }
    const def = DEFS[type];
    previewTiles.visible = true;
    previewTiles.material.color.set(ok ? '#6edc5a' : '#dc4632');
    previewTiles.scale.set(def.w, def.h, 1);
    const c = tileToWorld(tx, ty, def.w, def.h);
    previewTiles.position.set(c.x, 0.03, c.z);
    if (models[type]) {
      curGhost = ghostModels[type][ok ? 'ok' : 'bad'];
      curGhost.position.copy(c);
      scene.add(curGhost);
    }
  }
  function setDemolishHover(rect) {
    if (!rect) { demoQuad.visible = false; return; }
    demoQuad.visible = true;
    demoQuad.scale.set(rect.w, rect.h, 1);
    const c = tileToWorld(rect.x, rect.y, rect.w, rect.h);
    demoQuad.position.set(c.x, 0.04, c.z);
  }
  function setHoverOutline(rect) {
    if (!rect) { hoverQuad.visible = false; return; }
    hoverQuad.visible = true;
    hoverQuad.scale.set(rect.w, rect.h, 1);
    const c = tileToWorld(rect.x, rect.y, rect.w, rect.h);
    hoverQuad.position.set(c.x, 0.05, c.z);
  }

  // ---------- picking / projection ----------
  function pick(clientX, clientY) {
    const r = dom.getBoundingClientRect();
    ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(groundMesh, false)[0];
    if (!hit) return null;
    const tx = Math.floor(hit.point.x + COLS / 2);
    const ty = Math.floor(hit.point.z + ROWS / 2);
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return null;
    return { x: tx, y: ty };
  }
  const _proj = new THREE.Vector3();
  function projectTile(fx, fy, wy = 1.0) {
    _proj.set(fx - COLS / 2, wy, fy - ROWS / 2).project(camera);
    const r = dom.getBoundingClientRect();
    return { x: (_proj.x * 0.5 + 0.5) * r.width, y: (-_proj.y * 0.5 + 0.5) * r.height, behind: _proj.z > 1 };
  }

  // ---------- camera ----------
  function applyCamera() {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    camera.position.set(
      target.x + DIST * cp * Math.sin(yaw),
      target.y + DIST * sp,
      target.z + DIST * cp * Math.cos(yaw));
    camera.lookAt(target);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }
  function bindCamControls() {
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0012), 0.45, 5.5);
    }, { passive: false });
    dom.addEventListener('pointerdown', e => {
      if (e.button === 2 || e.button === 1) {
        dragBtn = e.button; dragX = e.clientX; dragY = e.clientY; didDrag = false;
        dom.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    });
    dom.addEventListener('pointermove', e => {
      if (dragBtn < 0) return;
      const dx = e.clientX - dragX, dy = e.clientY - dragY;
      dragX = e.clientX; dragY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 1) didDrag = true;
      if (dragBtn === 2) {
        yaw -= dx * 0.0055;
        pitch = clamp(pitch - dy * 0.004, 0.30, 1.45);
      } else {
        const s = 0.026 / zoom;
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        target.x -= (dx * cy - dy * sy) * s;
        target.z -= (-dx * sy - dy * cy) * s;
        target.x = clamp(target.x, -COLS / 2 - 8, COLS / 2 + 8);
        target.z = clamp(target.z, -ROWS / 2 - 18, ROWS / 2 + 8);
      }
    });
    dom.addEventListener('pointerup', e => { if (dragBtn >= 0 && e.button === dragBtn) dragBtn = -1; });
    dom.addEventListener('pointercancel', () => { dragBtn = -1; });
  }
  function wasDragging() { const d = didDrag; didDrag = false; return d; }
  function isDragging() { return dragBtn >= 0; }
  function zoomBy(f) { zoom = clamp(zoom * f, 0.45, 5.5); }

  // ---------- day/night ----------
  const SKY = {
    dayTop: new THREE.Color('#4d87bb'), dayBot: new THREE.Color('#d9e8ef'),
    nightTop: new THREE.Color('#070c1e'), nightBot: new THREE.Color('#1b2440'),
    duskBot: new THREE.Color('#f0a060'), duskTop: new THREE.Color('#7a6f9e'),
  };
  const _ct = new THREE.Color(), _cb = new THREE.Color(), _fc = new THREE.Color();
  function updateDayNight(tod) {
    const bright = 0.5 - 0.5 * Math.cos(2 * Math.PI * tod);
    const dusk = Math.max(0, 1 - Math.abs(tod - 0.80) * 6) + Math.max(0, 1 - Math.abs(tod - 0.22) * 6);
    nightAmt = Math.pow(1 - bright, 1.5);
    _ct.copy(SKY.nightTop).lerp(SKY.dayTop, bright).lerp(SKY.duskTop, clamp(dusk * 0.5, 0, 0.6));
    _cb.copy(SKY.nightBot).lerp(SKY.dayBot, bright).lerp(SKY.duskBot, clamp(dusk * 0.85, 0, 0.85));
    skyMat.uniforms.top.value.copy(_ct);
    skyMat.uniforms.bottom.value.copy(_cb);
    skyMat.uniforms.night.value = nightAmt;
    _fc.copy(_cb).lerp(new THREE.Color('#0c1322'), nightAmt * 0.7);
    scene.fog.color.copy(_fc);
    const ang = (tod - 0.5) * Math.PI;
    sun.position.set(Math.sin(ang) * 34 + 6, 13 + bright * 25, 16);
    skyMat.uniforms.sunDir.value.copy(sun.position).normalize();
    skyMat.uniforms.sunCol.value.setHSL(0.085, clamp(0.55 + dusk * 0.4, 0, 1), 0.72);
    sun.intensity = 0.10 + bright * 1.45 + dusk * 0.3;
    sun.color.setHSL(0.085 + bright * 0.035 - dusk * 0.03, clamp(0.55 - bright * 0.2 + dusk * 0.45, 0, 1), 0.66);
    ambient.intensity = 0.15 + bright * 0.30;
    ambient.color.setHSL(0.6 - dusk * 0.5, 0.18 + dusk * 0.2, 0.85);
    hemi.intensity = 0.16 + bright * 0.34;
    MAT.window.emissiveIntensity = nightAmt * 1.9;
    MAT.lantern.emissiveIntensity = nightAmt * 2.4;
    for (const a of auroras) a.material.opacity = nightAmt * nightAmt * 0.34;
    for (const cl of clouds) {
      for (const s of cl.children) {
        s.material.opacity = 0.10 + bright * 0.26;
        s.material.color.setRGB(1, 1, 1).lerp(new THREE.Color('#f4b88a'), clamp(dusk, 0, 1) * 0.8);
      }
    }
  }

  // ---------- per-frame ----------
  function frame(tod, dt = 0.016) {
    elapsed += dt;
    applyCamera();
    updateDayNight(tod);
    if (water) {
      water.material.map.offset.x = elapsed * 0.006;
      water.material.map.offset.y = Math.sin(elapsed * 0.05) * 0.02;
    }
    if (waterfall) {
      const m0 = waterfall.children[0].material, m1 = waterfall.children[1].material;
      m0.map.offset.y = (elapsed * 0.9) % 1;
      m1.map.offset.y = (elapsed * 1.4) % 1;
      for (let i = 2; i < 5; i++) {
        const f = waterfall.children[i];
        const p = Math.sin(elapsed * 2.2 + f.userData.ph);
        f.scale.set(1.6 + p * 0.25, 0.9 + p * 0.15, 1);
        f.material.opacity = 0.32 + p * 0.1;
      }
    }
    if (boat) {
      boat.position.x = -34 + ((elapsed * 0.55 + 14) % 68);
      boat.position.y = WATER_Y + Math.sin(elapsed * 0.8) * 0.02;
      boat.rotation.z = Math.sin(elapsed * 0.7) * 0.03;
    }
    for (const b of birds) {
      const u = b.userData;
      const a = elapsed * u.sp + u.ph;
      b.position.set(Math.cos(a) * u.r + 2, u.h + Math.sin(a * 2.3) * 0.4, Math.sin(a) * u.r - ROWS / 2 - 2);
      b.rotation.y = -a - Math.PI / 2;
      const flap = Math.sin(elapsed * 9 + u.ph) * 0.55;
      u.wl.rotation.z = flap; u.wr.rotation.z = -flap;
    }
    for (const m of mists) {
      m.position.x = m.userData.bx + Math.sin(elapsed * 0.04 + m.userData.ph) * 2.5;
    }
    for (const cl of clouds) {
      cl.position.x += dt * cl.userData.sp;
      if (cl.position.x > 95) cl.position.x = -95;
    }
    for (const a of auroras) {
      if (a.material.opacity < 0.01) continue;
      const pos = a.geometry.getAttribute('position');
      const base = a.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const bx = base[i * 3];
        pos.setZ(i, base[i * 3 + 2] + Math.sin(bx * 0.16 + elapsed * 0.5 + a.userData.ph) * 2.4);
      }
      pos.needsUpdate = true;
    }
    // motes ↔ fireflies
    for (const s of motes) {
      const u = s.userData;
      s.position.set(
        u.bx + Math.sin(elapsed * 0.21 + u.ph) * 1.6,
        u.by + Math.sin(elapsed * 0.45 + u.ph * 2.1) * 0.5,
        u.bz + Math.cos(elapsed * 0.17 + u.ph) * 1.6);
      if (nightAmt > 0.45) {
        s.material.color.set('#d8ff96');
        s.material.opacity = (0.25 + 0.55 * Math.max(0, Math.sin(elapsed * 2.4 + u.ph * 3))) * nightAmt;
        s.scale.set(0.09, 0.09, 1);
      } else {
        s.material.color.set('#fff6da');
        s.material.opacity = 0.16 * (1 - nightAmt);
        s.scale.set(0.13, 0.13, 1);
      }
    }
    for (const w of windmills) w.rotation.z = elapsed * 0.8;
    smokeTimer += dt;
    if (smokeTimer > 0.5 && smokeEmitters.length) {
      smokeTimer = 0;
      spawnSmoke(smokeEmitters[(Math.random() * smokeEmitters.length) | 0]);
    }
    for (const s of smokePool) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life += dt;
      if (u.life >= u.max) { s.visible = false; continue; }
      const t = u.life / u.max;
      s.position.y += dt * 0.5;
      s.position.x += dt * 0.12;
      const sc = 0.22 + t * 0.8;
      s.scale.set(sc, sc, 1);
      s.material.opacity = 0.34 * (1 - t) * Math.min(1, t * 6);
    }
    renderer.render(scene, camera);
  }
  let smokeIdx = 0, smokeTimer = 0;
  function spawnSmoke(p) {
    const s = smokePool[smokeIdx++ % smokePool.length];
    s.visible = true;
    s.position.set(p.x + (Math.random() - 0.5) * 0.06, p.y, p.z + (Math.random() - 0.5) * 0.06);
    s.userData.life = 0;
    s.userData.max = 2.6 + Math.random();
    s.scale.set(0.22, 0.22, 1);
  }

  // ---------- init / resize ----------
  function init(container) {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    dom = renderer.domElement;
    dom.id = 'game';
    container.appendChild(dom);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#cfe0e8', 78, 230);

    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);

    ambient = new THREE.AmbientLight('#e8eef5', 0.4);
    hemi = new THREE.HemisphereLight('#bcd6ea', '#4d5a3a', 0.45);
    sun = new THREE.DirectionalLight('#ffe2b8', 1.8);
    sun.position.set(18, 34, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 30; sc.bottom = -30;
    sc.near = 5; sc.far = 160;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0005;
    scene.add(ambient, hemi, sun, sun.target);

    buildTextures();
    buildSharedGeos();
    buildSky();

    groundCanvas = document.createElement('canvas');
    groundCanvas.width = COLS * PXT; groundCanvas.height = ROWS * PXT;
    groundCtx = groundCanvas.getContext('2d');
    groundTex = new THREE.CanvasTexture(groundCanvas);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = 4;
    const gGeo = new THREE.PlaneGeometry(COLS, ROWS);
    gGeo.rotateX(-Math.PI / 2);
    groundMesh = new THREE.Mesh(gGeo, lam({ map: groundTex }));
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    scatterGroup = new THREE.Group();
    buildingGroup = new THREE.Group();
    scene.add(scatterGroup, buildingGroup);

    buildValley();

    // birds
    const wingMat = lam({ color: '#23262b' });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Group();
      const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.16), wingMat);
      wl.position.x = -0.24;
      const wr = wl.clone(); wr.position.x = 0.24;
      b.add(wl, wr);
      b.userData = { r: 7 + i * 2.2, sp: 0.12 + (i % 3) * 0.03, ph: i * 1.1, h: 7 + (i % 3) * 1.4, wl, wr };
      scene.add(b);
      birds.push(b);
    }

    models = buildModels();
    ghostModels = makeGhosts();

    previewTiles = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: '#6edc5a', transparent: true, opacity: 0.3, depthWrite: false }));
    previewTiles.rotation.x = -Math.PI / 2;
    previewTiles.visible = false;
    demoQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: '#dc3c28', transparent: true, opacity: 0.35, depthWrite: false }));
    demoQuad.rotation.x = -Math.PI / 2;
    demoQuad.visible = false;
    hoverQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: '#fff5d2', transparent: true, opacity: 0.18, depthWrite: false }));
    hoverQuad.rotation.x = -Math.PI / 2;
    hoverQuad.visible = false;
    scene.add(previewTiles, demoQuad, hoverQuad);

    bindCamControls();
    onResize();
  }
  function onResize() {
    const w = dom.parentElement.clientWidth, h = dom.parentElement.clientHeight;
    renderer.setSize(w, h);
    const asp = w / h;
    camera.left = -VIEW * asp; camera.right = VIEW * asp;
    camera.top = VIEW; camera.bottom = -VIEW;
    camera.updateProjectionMatrix();
  }

  return {
    init, rebuildTerrain, syncBuildings, setPreview, setDemolishHover, setHoverOutline,
    pick, projectTile, frame, onResize, wasDragging, isDragging, zoomBy,
    get dom() { return dom; },
  };
})();
