'use strict';
/* ============================================================
   STONEBROOK 3D renderer v2 — "fjord valley" look.
   Painterly procedural canvas textures on low-poly models,
   a heightfield valley with an instanced spruce forest,
   animated fjord water, drifting boat, birds, mist and
   chimney smoke. No postprocessing; one shadowed sun.
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
  let skyMat, water, boat, birds = [], mists = [];
  let smokeEmitters = [], smokePool = [];
  let elapsed = 0;

  // camera rig
  const target = new THREE.Vector3(0, 0.5, 0);
  let yaw = 0, pitch = 0.66, zoom = 1.45;
  const DIST = 70, VIEW = 11;
  let dragBtn = -1, dragX = 0, dragY = 0, didDrag = false;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // ---------- small math helpers ----------
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  // deterministic value noise
  function vhash(ix, iz) {
    let h = (ix * 374761393 + iz * 668265263 + 1442695040888963407 % 2147483647) | 0;
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

  // ---------- texture helpers (painterly, smooth-filtered) ----------
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
    // weathered horizontal planks
    TEX.plank = makeTex(128, 128, (g, R) => {
      g.fillStyle = '#71593e'; g.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 16) {
        g.fillStyle = `rgb(${100 + R() * 28},${78 + R() * 22},${52 + R() * 16})`;
        g.fillRect(0, y, 128, 15);
        g.fillStyle = 'rgba(30,20,10,0.55)'; g.fillRect(0, y + 15, 128, 1.5);
        for (let i = 0; i < 7; i++) { // grain
          g.strokeStyle = `rgba(40,28,14,${0.10 + R() * 0.12})`;
          g.beginPath();
          const yy = y + 2 + R() * 12;
          g.moveTo(0, yy); g.bezierCurveTo(40, yy + R() * 3 - 1.5, 90, yy + R() * 3 - 1.5, 128, yy);
          g.stroke();
        }
      }
      speckle(g, 128, 128, 220, ['#4a3a26', '#8d7350', '#5d4a32'], R);
    });
    // lime plaster with timber frame
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
    // weathered wooden shingles (grey-brown, mossy patches)
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
      // moss tinge
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(${90 + R() * 30},${110 + R() * 35},${52 + R() * 20},${0.10 + R() * 0.16})`;
        g.beginPath(); g.arc(R() * 128, R() * 128, 4 + R() * 10, 0, 7); g.fill();
      }
    });
    // sod / thatch roof (for the well & sheds)
    TEX.sod = makeTex(96, 96, (g, R) => {
      g.fillStyle = '#5d7440'; g.fillRect(0, 0, 96, 96);
      for (let i = 0; i < 800; i++) {
        g.strokeStyle = `rgba(${60 + R() * 70},${90 + R() * 60},${30 + R() * 40},${0.25 + R() * 0.3})`;
        const x = R() * 96, y = R() * 96;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + R() * 3 - 1.5, y + 3 + R() * 3); g.stroke();
      }
    });
    // cool grey stone
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
    // dark bark
    TEX.bark = makeTex(64, 64, (g, R) => {
      g.fillStyle = '#4f3d2a'; g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(${30 + R() * 30},${24 + R() * 22},${14 + R() * 14},0.6)`;
        const x = R() * 64;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x + R() * 8 - 4, 64); g.stroke();
      }
    });
    // barrel: vertical staves + iron bands
    TEX.barrel = makeTex(64, 64, (g, R) => {
      g.fillStyle = '#6e5337'; g.fillRect(0, 0, 64, 64);
      for (let x = 0; x < 64; x += 9) {
        g.fillStyle = `rgb(${95 + R() * 25},${70 + R() * 18},${44 + R() * 12})`;
        g.fillRect(x, 0, 8, 64);
        g.fillStyle = 'rgba(25,15,8,0.5)'; g.fillRect(x + 8, 0, 1, 64);
      }
      g.fillStyle = '#3a3d42'; g.fillRect(0, 10, 64, 5); g.fillRect(0, 49, 64, 5);
    });
    // door (warm planks, iron hinges)
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
    // window + matching emissive glow map
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
    // sail
    TEX.sail = makeTex(64, 64, (g, R) => {
      g.fillStyle = '#cfc3a8'; g.fillRect(0, 0, 64, 64);
      for (let x = 0; x < 64; x += 16) { g.fillStyle = 'rgba(140,70,50,0.75)'; g.fillRect(x, 0, 8, 64); }
      speckle(g, 64, 64, 90, ['#9a8d72', '#e0d6bc'], R);
    }, false);
    // farm field
    TEX.field = makeTex(96, 96, (g, R) => {
      g.fillStyle = '#54422c'; g.fillRect(0, 0, 96, 96);
      for (let x = 4; x < 96; x += 12) {
        g.fillStyle = '#3f3120'; g.fillRect(x, 0, 5, 96);
        for (let y = 4; y < 96; y += 8) {
          if (R() < 0.85) {
            g.fillStyle = `rgb(${90 + R() * 40},${130 + R() * 50},${50 + R() * 30})`;
            g.beginPath(); g.arc(x + 2.5, y, 2.5 + R() * 1.5, 0, 7); g.fill();
          }
        }
      }
    }, false);
    // quarry pit
    TEX.quarry = makeTex(96, 96, (g, R) => {
      g.fillStyle = '#6e7277'; g.fillRect(0, 0, 96, 96);
      g.fillStyle = '#54585d'; g.fillRect(10, 10, 76, 76);
      g.fillStyle = '#44484d'; g.fillRect(22, 22, 52, 52);
      g.fillStyle = '#3a3e43'; g.fillRect(34, 34, 28, 28);
      speckle(g, 96, 96, 260, ['#8b9096', '#5d6166', '#75797e'], R, 3);
    }, false);
    // garden bed
    TEX.garden = makeTex(64, 64, (g, R) => {
      g.fillStyle = '#41331f'; g.fillRect(0, 0, 64, 64);
      speckle(g, 64, 64, 120, ['#2f2516', '#52422a'], R);
    }, false);
    // soft radial puff for smoke / mist
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
    // neutral detail noise for the valley heightfield
    TEX.terrNoise = makeTex(64, 64, (g, R) => {
      g.fillStyle = '#9c9c9c'; g.fillRect(0, 0, 64, 64);
      speckle(g, 64, 64, 700, ['#8a8a8a', '#b0b0b0', '#787878'], R);
    });
    TEX.terrNoise.repeat.set(40, 30);

    // shared materials
    MAT.plank = lam({ map: TEX.plank });
    MAT.plaster = lam({ map: TEX.plaster });
    MAT.shingle = lam({ map: TEX.shingle });
    MAT.sod = lam({ map: TEX.sod });
    MAT.stone = lam({ map: TEX.stone });
    MAT.bark = lam({ map: TEX.bark });
    MAT.barrel = lam({ map: TEX.barrel });
    MAT.door = lam({ map: TEX.door });
    MAT.window = lam({ map: TEX.window, emissive: new THREE.Color('#ffb45e'), emissiveMap: TEX.windowGlow, emissiveIntensity: 0 });
    MAT.needles = lam({ vertexColors: true });
    MAT.sail = lam({ map: TEX.sail, side: THREE.DoubleSide });
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
  // Nordic gable roof: prism with shingled slopes and wooden gable ends
  function gableRoof(w, h, d, slopeMat = MAT.shingle, endMat = MAT.plank, over = 0.14) {
    const hw = w / 2 + over, hd = d / 2 + over;
    const P = [];
    const quad = (a, b, c2, dd) => { P.push(...a, ...b, ...c2, ...a, ...c2, ...dd); };
    // front slope (+z), back slope (-z)
    quad([-hw, 0, hd], [hw, 0, hd], [hw, h, 0], [-hw, h, 0]);
    quad([hw, 0, -hd], [-hw, 0, -hd], [-hw, h, 0], [hw, h, 0]);
    // gable end triangles (x = ±hw)
    P.push(-hw, 0, hd, -hw, h, 0, -hw, 0, -hd);
    P.push(hw, 0, -hd, hw, h, 0, hw, 0, hd);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const su = w * 1.6, sv = Math.hypot(h, hd) * 1.6; // shingle density
    const uv = [
      0, 0, su, 0, su, sv, 0, 0, su, sv, 0, sv,
      0, 0, su, 0, su, sv, 0, 0, su, sv, 0, sv,
      0, 0, h, d / 2, 0, d,
      0, 0, h, d / 2, 0, d,
    ];
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.addGroup(0, 12, 0);
    g.addGroup(12, 6, 1);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, [slopeMat, endMat]);
    m.castShadow = true; m.receiveShadow = true;
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
  // merge simple geometries (non-indexed) with a per-part vertex color
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
  let spruceGeo = null;
  function buildSpruceGeo() {
    spruceGeo = mergeWithColors([
      [new THREE.CylinderGeometry(0.05, 0.08, 0.5, 6), M4(0, 0.25, 0), '#4f3d2a'],
      [new THREE.ConeGeometry(0.52, 0.95, 7), M4(0, 0.85, 0), '#2e4a28'],
      [new THREE.ConeGeometry(0.40, 0.85, 7), M4(0, 1.35, 0), '#35562e'],
      [new THREE.ConeGeometry(0.27, 0.75, 7), M4(0, 1.85, 0), '#3d6334'],
    ]);
  }
  function treeModel(variant) {
    const grp = new THREE.Group();
    if (variant % 3 !== 2) {
      const m = new THREE.Mesh(spruceGeo, MAT.needles);
      m.castShadow = true; m.receiveShadow = true;
      const s = 0.85 + (variant % 5) * 0.09;
      m.scale.setScalar(s);
      grp.add(m);
    } else { // leafy tree for variety
      const trunk = cyl(0.06, 0.45, MAT.bark);
      trunk.position.y = 0.22;
      const canopyMat = lam({ color: variant % 2 ? '#4d7038' : '#557a3c' });
      const c1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 1), canopyMat);
      c1.position.y = 0.72; c1.scale.y = 0.85;
      c1.castShadow = true; c1.receiveShadow = true;
      const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), canopyMat);
      c2.position.set(0.16, 0.98, 0.1);
      c2.castShadow = true;
      grp.add(trunk, c1, c2);
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

  // ---------- building models ----------
  function addDoor(grp, x, y, z, w = 0.32, h = 0.46, ry = 0) {
    const d = decal(w, h, MAT.door);
    d.position.set(x, y, z); d.rotation.y = ry;
    grp.add(d);
  }
  function addWindow(grp, x, y, z, ry = 0, s = 0.26) {
    const d = decal(s, s, MAT.window);
    d.position.set(x, y, z); d.rotation.y = ry;
    grp.add(d);
  }
  function house({ w, d, wallH, roofH, wallMat, roofMat, chimney, windows, doorSide = 1 }) {
    const grp = new THREE.Group();
    const wall = box(w, wallH, d, wallMat);
    wall.position.y = wallH / 2;
    grp.add(wall);
    // stone foundation
    const found = box(w + 0.06, 0.12, d + 0.06, MAT.stone);
    found.position.y = 0.06;
    grp.add(found);
    const roof = gableRoof(w, roofH, d, roofMat, wallMat);
    roof.position.y = wallH;
    grp.add(roof);
    if (chimney) {
      const ch = box(0.16, roofH + 0.42, 0.16, MAT.stone);
      ch.position.set(w * 0.26, wallH + (roofH + 0.42) / 2 - 0.1, -d * 0.12);
      grp.add(ch);
      grp.userData.smoke = new THREE.Vector3(w * 0.26, wallH + roofH + 0.4, -d * 0.12);
    }
    addDoor(grp, 0, 0.24, doorSide * (d / 2 + 0.012), 0.32, 0.46, doorSide < 0 ? Math.PI : 0);
    for (const [wx, wy, wz, ry] of windows || []) addWindow(grp, wx, wy, wz, ry);
    return grp;
  }
  function buildModels() {
    const M = {};
    M.cottage = house({
      w: 1.62, d: 1.38, wallH: 0.72, roofH: 0.62, wallMat: MAT.plank, roofMat: MAT.shingle, chimney: true,
      windows: [[-0.5, 0.42, 1.38 / 2 + 0.012, 0], [0.5, 0.42, 1.38 / 2 + 0.012, 0],
                [-1.62 / 2 - 0.012, 0.42, 0, -Math.PI / 2]],
    });
    M.bakery = house({
      w: 1.62, d: 1.38, wallH: 0.78, roofH: 0.6, wallMat: MAT.plaster, roofMat: MAT.shingle, chimney: true,
      windows: [[-0.5, 0.46, 1.38 / 2 + 0.012, 0]],
    });
    {
      const awn = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.34), MAT.sail);
      awn.position.set(0.45, 0.6, 1.38 / 2 + 0.16);
      awn.rotation.x = -0.7;
      awn.castShadow = true;
      M.bakery.add(awn);
    }
    M.manor = (() => {
      const grp = house({
        w: 2.5, d: 1.6, wallH: 1.0, roofH: 0.85, wallMat: MAT.plank, roofMat: MAT.shingle, chimney: true,
        windows: [[-0.8, 0.6, 0.8 + 0.012, 0], [0.8, 0.6, 0.8 + 0.012, 0],
                  [-0.8, 0.6, -0.8 - 0.012, Math.PI], [0.8, 0.6, -0.8 - 0.012, Math.PI]],
      });
      // perpendicular wing
      const wing = box(1.0, 0.9, 1.5, MAT.plank);
      wing.position.set(-0.6, 0.45, 0.55);
      grp.add(wing);
      const wingRoof = gableRoof(1.5, 0.6, 1.0, MAT.shingle, MAT.plank);
      wingRoof.rotation.y = Math.PI / 2;
      wingRoof.position.set(-0.6, 0.9, 0.55);
      grp.add(wingRoof);
      addWindow(grp, -0.6, 0.55, 1.3 + 0.012, 0, 0.3);
      const hedgeMat = lam({ color: '#46663a' });
      for (const hx of [0.7, 1.1]) {
        const h = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), hedgeMat);
        h.position.set(hx, 0.14, 1.0); h.castShadow = true;
        grp.add(h);
      }
      return grp;
    })();
    M.farm = (() => {
      const grp = new THREE.Group();
      const f = flatDecal(2.85, 2.85, TEX.field);
      f.position.y = 0.02;
      grp.add(f);
      // fence
      const railMat = MAT.bark;
      for (const [x, z, rl, ry] of [[0, -1.45, 2.95, 0], [0, 1.45, 2.95, 0], [-1.45, 0, 2.95, Math.PI / 2], [1.45, 0, 2.95, Math.PI / 2]]) {
        const rail = box(rl, 0.05, 0.05, railMat);
        rail.position.set(x, 0.34, z); rail.rotation.y = ry;
        grp.add(rail);
      }
      for (const px2 of [-1.45, 0, 1.45]) for (const pz of [-1.45, 1.45]) {
        const post = box(0.07, 0.5, 0.07, railMat);
        post.position.set(px2, 0.25, pz);
        grp.add(post);
      }
      // scarecrow
      const pole = cyl(0.03, 0.7, MAT.bark);
      pole.position.set(0.45, 0.35, 0.35);
      const arm = box(0.5, 0.05, 0.05, MAT.bark);
      arm.position.set(0.45, 0.52, 0.35);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 6), lam({ color: '#d8b95c' }));
      head.castShadow = true;
      head.position.set(0.45, 0.68, 0.35);
      grp.add(pole, arm, head);
      return grp;
    })();
    M.lumber = (() => {
      const grp = new THREE.Group();
      const mkLog = (x, y, z) => {
        const l = cyl(0.12, 1.05, MAT.bark);
        l.rotation.z = Math.PI / 2;
        l.position.set(x, y, z);
        return l;
      };
      grp.add(mkLog(-0.3, 0.12, 0.4), mkLog(-0.3, 0.12, 0.66), mkLog(-0.3, 0.33, 0.53));
      // open log shelter
      for (const sx of [-0.75, 0.15]) for (const sz of [-0.6, 0.05]) {
        const post = box(0.07, 0.8, 0.07, MAT.bark);
        post.position.set(sx, 0.4, sz);
        grp.add(post);
      }
      const shRoof = gableRoof(1.0, 0.3, 0.75, MAT.sod, MAT.plank, 0.1);
      shRoof.position.set(-0.3, 0.8, -0.28);
      grp.add(shRoof);
      const planks = box(0.65, 0.18, 0.4, MAT.plank);
      planks.position.set(-0.3, 0.09, -0.3);
      grp.add(planks);
      const stump = cyl(0.16, 0.22, MAT.bark);
      stump.position.set(0.55, 0.11, 0.35);
      grp.add(stump);
      const axeH = box(0.04, 0.38, 0.04, MAT.bark);
      axeH.position.set(0.55, 0.38, 0.35); axeH.rotation.z = 0.4;
      const axeB = box(0.15, 0.08, 0.03, MAT.stone);
      axeB.position.set(0.48, 0.52, 0.35);
      grp.add(axeH, axeB);
      return grp;
    })();
    M.quarry = (() => {
      const grp = new THREE.Group();
      const f = flatDecal(1.88, 1.88, TEX.quarry);
      f.position.y = 0.02;
      grp.add(f);
      const b1 = box(0.34, 0.26, 0.3, MAT.stone);
      b1.position.set(-0.4, 0.13, 0.42);
      const b2 = box(0.26, 0.2, 0.24, MAT.stone);
      b2.position.set(0.45, 0.1, -0.35); b2.rotation.y = 0.5;
      grp.add(b1, b2);
      // A-frame hoist
      const legA = box(0.06, 1.0, 0.06, MAT.bark); legA.position.set(0.35, 0.48, 0.4); legA.rotation.z = -0.35;
      const legB = box(0.06, 1.0, 0.06, MAT.bark); legB.position.set(0.75, 0.48, 0.4); legB.rotation.z = 0.35;
      const beam = box(0.9, 0.05, 0.05, MAT.bark); beam.position.set(0.55, 0.92, 0.4);
      grp.add(legA, legB, beam);
      return grp;
    })();
    M.well = (() => {
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
      const roof = gableRoof(0.72, 0.28, 0.5, MAT.sod, MAT.plank, 0.06);
      roof.position.y = 0.8;
      grp.add(roof);
      const bucket = cyl(0.07, 0.1, MAT.barrel, 0.06);
      bucket.position.y = 0.52;
      grp.add(bucket);
      return grp;
    })();
    M.garden = (() => {
      const grp = new THREE.Group();
      const rim = box(0.94, 0.09, 0.94, MAT.bark);
      rim.position.y = 0.045;
      grp.add(rim);
      const bed = flatDecal(0.8, 0.8, TEX.garden);
      bed.position.y = 0.095;
      grp.add(bed);
      const cols = ['#c84a3c', '#d8b95c', '#b66a9e', '#e6e2d2', '#7d92c9'];
      const R = mulberry32(515);
      for (let i = 0; i < 9; i++) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), lam({ color: cols[i % cols.length] }));
        fl.position.set(-0.28 + (i % 3) * 0.28, 0.16 + R() * 0.05, -0.28 + ((i / 3) | 0) * 0.28);
        fl.castShadow = true;
        const stem = cyl(0.012, 0.1, lam({ color: '#3d6334' }), 0.012, 5);
        stem.position.set(fl.position.x, 0.1, fl.position.z);
        grp.add(stem, fl);
      }
      return grp;
    })();
    M.market = (() => {
      const grp = new THREE.Group();
      const stall = (x, tint) => {
        const s = new THREE.Group();
        const counter = box(1.1, 0.42, 0.58, MAT.plank);
        counter.position.y = 0.21;
        s.add(counter);
        for (const sx of [-0.5, 0.5]) for (const sz of [-0.24, 0.24]) {
          const post = box(0.05, 1.0, 0.05, MAT.bark);
          post.position.set(sx, 0.5, sz);
          s.add(post);
        }
        const roof = gableRoof(1.15, 0.3, 0.7, tint ? MAT.sail : MAT.sod, MAT.plank, 0.1);
        roof.position.y = 1.0;
        s.add(roof);
        const gR = mulberry32(99 + x * 10);
        for (let i = 0; i < 4; i++) {
          const g = box(0.1, 0.1, 0.1, lam({ color: ['#c84a3c', '#d8b95c', '#cf7d3a', '#7da45a'][i] }));
          g.position.set(-0.36 + i * 0.24, 0.47, 0.08 + gR() * 0.1);
          s.add(g);
        }
        s.position.x = x;
        return s;
      };
      grp.add(stall(-0.72, true), stall(0.72, false));
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
      return grp;
    })();
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

  // ---------- valley environment ----------
  const WATER_Y = -0.34;
  function terrainH(x, z) {
    const dx = Math.max(0, Math.abs(x) - COLS / 2 - 0.5);
    const dz = Math.max(0, Math.abs(z) - ROWS / 2 - 0.5);
    const d = Math.hypot(dx, dz);
    if (d <= 0) return -0.05;
    let h = Math.pow(Math.min(1, d / 24), 1.7) * (10 + 6 * fbm(x * 0.05 + 7, z * 0.05 + 3));
    h += sstep(0, 3, d) * (fbm(x * 0.3, z * 0.3) - 0.5) * 1.2;
    // fjord channel cutting through the northern hills
    const depth = -(z + ROWS / 2);
    if (depth > 0) {
      const cx = 3 + Math.sin(depth * 0.12) * 4;
      const half = 4.5 + depth * 0.55;
      const f = Math.max(0, 1 - Math.abs(x - cx) / half);
      h -= sstep(0, 5, depth) * f * f * (h + 2.5);
    }
    return h;
  }
  function buildValley() {
    const SK = 30;
    const w = COLS + SK * 2, d = ROWS + SK * 2;
    const segX = Math.round(w * 1.4), segZ = Math.round(d * 1.4);
    const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(), rock = new THREE.Color('#787d82'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainH(x, z);
      pos.setY(i, h);
      // slope from numerical gradient
      const e = 0.6;
      const sl = Math.hypot(terrainH(x + e, z) - terrainH(x - e, z), terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
      const n = fbm(x * 0.2 + 31, z * 0.2 + 17);
      grass.setRGB(0.36 + n * 0.14, 0.48 + n * 0.14, 0.26 + n * 0.10);
      c.copy(grass).lerp(rock, sstep(0.45, 0.95, sl + n * 0.15));
      if (h < WATER_Y + 0.25) c.lerp(new THREE.Color('#5d5648'), 0.6); // shoreline
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, lam({ vertexColors: true, map: TEX.terrNoise }));
    mesh.position.y = -0.06;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // instanced spruce forest on the hillsides
    const R = mulberry32(987654);
    const tries = 2600, placed = [];
    for (let i = 0; i < tries && placed.length < 420; i++) {
      const x = (R() * 2 - 1) * (COLS / 2 + SK - 2);
      const z = (R() * 2 - 1) * (ROWS / 2 + SK - 2);
      const inPlay = Math.abs(x) < COLS / 2 + 1.5 && Math.abs(z) < ROWS / 2 + 1.5;
      if (inPlay) continue;
      const h = terrainH(x, z);
      if (h < 0.25) continue;
      const e = 0.6;
      const sl = Math.hypot(terrainH(x + e, z) - terrainH(x - e, z), terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
      if (sl > 0.85) continue;
      placed.push({ x, z, h, s: 1.0 + R() * 1.4, r: R() * 6.3, t: 0.78 + R() * 0.4 });
    }
    const forest = new THREE.InstancedMesh(spruceGeo, MAT.needles, placed.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    const tint = new THREE.Color();
    placed.forEach((p, i) => {
      q.setFromAxisAngle(up, p.r);
      sc.setScalar(p.s);
      m4.compose(new THREE.Vector3(p.x, p.h - 0.1, p.z), q, sc);
      forest.setMatrixAt(i, m4);
      tint.setRGB(p.t, p.t + 0.04, p.t);
      forest.setColorAt(i, tint);
    });
    forest.castShadow = true;
    forest.receiveShadow = true;
    scene.add(forest);

    // fjord water
    const wgeo = new THREE.PlaneGeometry(170, 110);
    wgeo.rotateX(-Math.PI / 2);
    const wtex = makeTex(128, 128, (g, Rr) => {
      g.fillStyle = '#3c6271'; g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 240; i++) {
        g.strokeStyle = `rgba(${170 + Rr() * 60},${200 + Rr() * 40},${215 + Rr() * 30},${0.05 + Rr() * 0.09})`;
        const x = Rr() * 128, y = Rr() * 128;
        g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 8, y + 1, x + 16, y - 1, x + 22 + Rr() * 10, y);
        g.stroke();
      }
    });
    wtex.repeat.set(8, 6);
    water = new THREE.Mesh(wgeo, new THREE.MeshPhongMaterial({
      map: wtex, color: '#9db8c2', specular: '#dff0f8', shininess: 90,
      transparent: true, opacity: 0.94,
    }));
    water.position.set(0, WATER_Y, -(ROWS / 2) - 18);
    scene.add(water);

    // drifting longboat
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

    // mist banks
    for (let i = 0; i < 7; i++) {
      const sm = new THREE.SpriteMaterial({ map: TEX.puff, color: '#e8eef2', transparent: true, opacity: 0.10, depthWrite: false });
      const s = new THREE.Sprite(sm);
      const mx = -26 + i * 9 + (i % 2) * 4;
      s.position.set(mx, 0.8 + (i % 3) * 0.5, -(ROWS / 2) - 4 - (i % 4) * 5);
      s.scale.set(16 + (i % 3) * 6, 4.5, 1);
      s.userData = { bx: mx, ph: i * 1.7 };
      scene.add(s);
      mists.push(s);
    }

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
  let smokeIdx = 0, smokeTimer = 0;
  function spawnSmoke(p) {
    const s = smokePool[smokeIdx++ % smokePool.length];
    s.visible = true;
    s.position.set(p.x + (Math.random() - 0.5) * 0.06, p.y, p.z + (Math.random() - 0.5) * 0.06);
    s.userData.life = 0;
    s.userData.max = 2.6 + Math.random();
    s.scale.set(0.22, 0.22, 1);
  }

  // ---------- sky ----------
  function buildSky() {
    skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color('#6f9cc4') },
        bottom: { value: new THREE.Color('#d4e4ec') },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bottom;
        void main(){ float t = pow(max(normalize(vP).y, 0.0), 0.55);
        gl_FragColor = vec4(mix(bottom, top, t), 1.0); }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(220, 20, 12), skyMat);
    scene.add(dome);
  }

  // ---------- terrain (playable ground) ----------
  const PXT = 24; // texture px per tile
  function paintGroundCanvas() {
    const g = groundCtx, R = mulberry32(8311);
    // soft irregular blobs per tile hide the grid
    const tileCol = (x, y) => {
      const t = state.terrain[y][x];
      const n = fbm(x * 0.3, y * 0.3);
      if (t === T_PATH) return `rgb(${118 + n * 18 | 0},${98 + n * 14 | 0},${72 + n * 10 | 0})`;
      if (t === T_GRASS || t === T_TREE || t === T_ROCK)
        return `rgb(${80 + n * 26 | 0},${120 + n * 26 | 0},${54 + n * 18 | 0})`;
      return `rgb(${110 + n * 22 | 0},${124 + n * 20 | 0},${74 + n * 16 | 0})`;
    };
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      g.fillStyle = tileCol(x, y);
      g.fillRect(x * PXT, y * PXT, PXT, PXT);
    }
    // soft cross-bleed blobs to hide the tile grid
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
    // global speckle
    for (let i = 0; i < COLS * ROWS * 9; i++) {
      const x = R() * COLS * PXT, y = R() * ROWS * PXT;
      g.fillStyle = R() < 0.5 ? 'rgba(40,60,25,0.18)' : 'rgba(225,235,190,0.13)';
      g.fillRect(x, y, 1.5, 1.5);
    }
    // flowers on grass, stones on paths
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = state.terrain[y][x];
      if ((t === T_GRASS) && hash2(x, y) % 3 === 0) {
        const fr = mulberry32(hash2(x, y));
        const cols = ['#e6e2d2', '#e3c95c', '#7d92c9', '#c87f9e'];
        for (let i = 0; i < 4; i++) {
          g.fillStyle = cols[(fr() * cols.length) | 0];
          g.beginPath();
          g.arc(x * PXT + 3 + fr() * (PXT - 6), y * PXT + 3 + fr() * (PXT - 6), 1.2 + fr(), 0, 7);
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
  function rebuildTerrain() {
    paintGroundCanvas();
    groundTex.needsUpdate = true;
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
    let smokeDirty = false;
    for (const b of state.buildings) {
      seen.add(b);
      if (!meshByBuilding.has(b)) {
        const def = DEFS[b.type];
        const m = models[b.type].clone(true);
        m.position.copy(tileToWorld(b.x, b.y, def.w, def.h));
        buildingGroup.add(m);
        meshByBuilding.set(b, m);
        smokeDirty = true;
      }
    }
    for (const [b, m] of meshByBuilding) {
      if (!seen.has(b)) { buildingGroup.remove(m); meshByBuilding.delete(b); smokeDirty = true; }
    }
    if (smokeDirty) {
      smokeEmitters = [];
      for (const [b, m] of meshByBuilding) {
        const sm = models[b.type].userData.smoke;
        if (sm) smokeEmitters.push(new THREE.Vector3().copy(sm).add(m.position));
      }
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
        target.x = clamp(target.x, -COLS / 2 - 6, COLS / 2 + 6);
        target.z = clamp(target.z, -ROWS / 2 - 14, ROWS / 2 + 6);
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
    dayTop: new THREE.Color('#5e93c0'), dayBot: new THREE.Color('#d6e6ee'),
    nightTop: new THREE.Color('#0c1226'), nightBot: new THREE.Color('#222c48'),
    duskBot: new THREE.Color('#e8a36a'),
  };
  const _ct = new THREE.Color(), _cb = new THREE.Color();
  function updateDayNight(tod) {
    const bright = 0.5 - 0.5 * Math.cos(2 * Math.PI * tod);
    const dusk = Math.max(0, 1 - Math.abs(tod - 0.80) * 8) + Math.max(0, 1 - Math.abs(tod - 0.22) * 8);
    _ct.copy(SKY.nightTop).lerp(SKY.dayTop, bright);
    _cb.copy(SKY.nightBot).lerp(SKY.dayBot, bright).lerp(SKY.duskBot, clamp(dusk * 0.6, 0, 0.7));
    skyMat.uniforms.top.value.copy(_ct);
    skyMat.uniforms.bottom.value.copy(_cb);
    scene.fog.color.copy(_cb);
    sun.intensity = 0.10 + bright * 1.45;
    sun.color.setHSL(0.085 + bright * 0.035, clamp(0.6 - bright * 0.25 + dusk * 0.25, 0, 1), 0.72);
    ambient.intensity = 0.16 + bright * 0.30;
    hemi.intensity = 0.18 + bright * 0.34;
    const ang = (tod - 0.5) * Math.PI;
    sun.position.set(Math.sin(ang) * 34 + 6, 16 + bright * 22, 16);
    MAT.window.emissiveIntensity = (1 - bright) * 1.6; // windows glow at dusk/night
  }

  // ---------- per-frame ----------
  function frame(tod, dt = 0.016) {
    elapsed += dt;
    applyCamera();
    updateDayNight(tod);
    // water shimmer
    if (water) {
      water.material.map.offset.x = elapsed * 0.006;
      water.material.map.offset.y = Math.sin(elapsed * 0.05) * 0.02;
    }
    // boat drift
    if (boat) {
      boat.position.x = -34 + ((elapsed * 0.55 + 14) % 68);
      boat.position.y = WATER_Y + Math.sin(elapsed * 0.8) * 0.02;
      boat.rotation.z = Math.sin(elapsed * 0.7) * 0.03;
    }
    // birds
    for (const b of birds) {
      const u = b.userData;
      const a = elapsed * u.sp + u.ph;
      b.position.set(Math.cos(a) * u.r + 2, u.h + Math.sin(a * 2.3) * 0.4, Math.sin(a) * u.r - ROWS / 2 - 2);
      b.rotation.y = -a - Math.PI / 2;
      const flap = Math.sin(elapsed * 9 + u.ph) * 0.55;
      u.wl.rotation.z = flap; u.wr.rotation.z = -flap;
    }
    // mist drift
    for (const m of mists) {
      m.position.x = m.userData.bx + Math.sin(elapsed * 0.04 + m.userData.ph) * 2.5;
    }
    // smoke
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
    // linear fog: with an ortho camera everything is ~70 units away, so
    // exponential fog would haze the whole scene uniformly
    scene.fog = new THREE.Fog('#cfe0e8', 78, 215);

    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);

    ambient = new THREE.AmbientLight('#e8eef5', 0.4);
    hemi = new THREE.HemisphereLight('#bcd6ea', '#4d5a3a', 0.45);
    sun = new THREE.DirectionalLight('#ffe2b8', 1.8);
    sun.position.set(18, 34, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 26; sc.bottom = -26;
    sc.near = 5; sc.far = 140;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0005;
    scene.add(ambient, hemi, sun, sun.target);

    buildTextures();
    buildSpruceGeo();
    buildSky();

    // playable ground plane
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
