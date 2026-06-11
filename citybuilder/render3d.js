'use strict';
/* ============================================================
   STONEBROOK 3D renderer (Three.js)
   Pixel-art canvas textures on simple 3D models — an
   "HD-2D diorama" look. Owns the camera (zoom/rotate/pan),
   picking, terrain ground plane, scatter (trees/rocks),
   building meshes, and placement previews.
   ============================================================ */

const R3 = (() => {
  let renderer, scene, camera, dom;
  let sun, moonGlow, ambient, hemi;
  let groundCanvas, groundCtx, groundTex, groundMesh;
  let scatterGroup, buildingGroup;
  const meshByBuilding = new Map();
  let previewGhost = null, previewTiles = null, hoverQuad = null, demoQuad = null;
  let models = {}, ghostModels = {};
  let TEX = {};

  // camera rig
  const target = new THREE.Vector3(0, 0, 0);
  let yaw = 0, pitch = 0.72, zoom = 1.3;
  const DIST = 60, VIEW = 11;
  let dragBtn = -1, dragX = 0, dragY = 0, didDrag = false;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // ---------- texture helpers ----------
  function canvasTex(w, h, paint, repeat) {
    const [c, g] = mkc(w, h);
    paint(px(g), mulberry32(7777), g);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }
  function spriteTex(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function lam(opts) { return new THREE.MeshLambertMaterial(opts); }

  function buildTextures() {
    const R = mulberry32(4242);
    TEX.wall = canvasTex(48, 32, (p, r) => paintWall(p, r, 0, 0, 48, 32));
    TEX.roof = canvasTex(64, 48, (p, r) => paintRoof(p, r, 0, 0, 64, 48));
    TEX.plaster = canvasTex(48, 32, (p, r, g) => {
      p(0, 0, C.plaster, 48, 32);
      for (let i = 0; i < 40; i++) p(r() * 48, r() * 32, C.plasterD);
      p(0, 0, C.woodD, 48, 2); p(0, 30, C.woodD, 48, 2);
      p(0, 0, C.woodD, 2, 32); p(46, 0, C.woodD, 2, 32);
      p(15, 0, C.woodD, 2, 32); p(31, 0, C.woodD, 2, 32);
    });
    TEX.door = spriteTex((() => {
      const [c, g] = mkc(12, 16); const p = px(g);
      paintDoor(p, 1, 1, 10, 15);
      return c;
    })());
    TEX.window = spriteTex((() => {
      const [c, g] = mkc(8, 10); const p = px(g);
      const R2 = mulberry32(99);
      paintWindow(p, R2, 2, 2);
      paintFlowerBox(p, R2, 1, 8, 6);
      return c;
    })());
    TEX.leaf = canvasTex(24, 24, (p, r) => {
      p(0, 0, C.leaf, 24, 24);
      for (let i = 0; i < 26; i++) p(r() * 24, r() * 24, r() < 0.5 ? C.leafD : C.leafL);
      for (let i = 0; i < 8; i++) p(r() * 24, r() * 24, C.leafHi);
    }, true);
    TEX.leafR = canvasTex(24, 24, (p, r) => {
      p(0, 0, C.leaf, 24, 24);
      for (let i = 0; i < 22; i++) p(r() * 24, r() * 24, r() < 0.5 ? C.leafD : C.leafL);
      for (let i = 0; i < 7; i++) { const x = r() * 22, y = r() * 22; p(x, y, C.fR); p(x + 1, y, C.fR2); }
    }, true);
    TEX.leafP = canvasTex(24, 24, (p, r) => {
      p(0, 0, C.leaf, 24, 24);
      for (let i = 0; i < 22; i++) p(r() * 24, r() * 24, r() < 0.5 ? C.leafD : C.leafL);
      for (let i = 0; i < 7; i++) { const x = r() * 22, y = r() * 22; p(x, y, C.fP); p(x + 1, y, C.fP2); }
    }, true);
    TEX.stone = canvasTex(32, 32, (p, r) => {
      p(0, 0, C.stone, 32, 32);
      for (let i = 0; i < 30; i++) p(r() * 32, r() * 32, r() < 0.5 ? C.stoneL : C.stoneD, 2, 1);
    }, true);
    TEX.bark = canvasTex(16, 16, (p, r) => {
      p(0, 0, C.wood, 16, 16);
      for (let i = 0; i < 10; i++) p(r() * 16, r() * 16, r() < 0.5 ? C.woodD : C.woodL, 1, 3);
    }, true);
    TEX.plank = canvasTex(24, 24, (p, r) => {
      p(0, 0, C.plank, 24, 24);
      for (let y = 0; y < 24; y += 6) p(0, y, C.woodL, 24, 1);
      for (let i = 0; i < 12; i++) p(r() * 24, r() * 24, '#b8905c');
    }, true);
    TEX.crate = spriteTex((() => {
      const [c, g] = mkc(16, 16); const p = px(g);
      p(0, 0, C.plank, 16, 16);
      p(0, 0, C.woodD, 16, 2); p(0, 14, C.woodD, 16, 2); p(0, 0, C.woodD, 2, 16); p(14, 0, C.woodD, 2, 16);
      for (let i = 2; i < 14; i++) { p(i, i, C.woodL); p(15 - i, i, C.woodL); }
      return c;
    })());
    TEX.awnR = canvasTex(32, 16, (p) => {
      for (let x = 0; x < 32; x += 8) { p(x, 0, C.roof, 4, 16); p(x + 4, 0, C.fW, 4, 16); }
    }, true);
    TEX.awnG = canvasTex(32, 16, (p) => {
      for (let x = 0; x < 32; x += 8) { p(x, 0, C.leaf, 4, 16); p(x + 4, 0, C.fW, 4, 16); }
    }, true);
    TEX.field = spriteTex(SPRITE_FNS.farm(mulberry32(31)));
    TEX.gardenT = spriteTex(SPRITE_FNS.garden(mulberry32(32)));
    TEX.quarryT = spriteTex(SPRITE_FNS.quarry(mulberry32(33)));
  }

  // ---------- model parts ----------
  function box(w, h, d, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function hipRoof(w, h, d, mat) {
    // 4-sided pyramid; bake the 45° spin into the geometry so the
    // non-uniform scale below stays axis-aligned (no shearing)
    const g = new THREE.ConeGeometry(0.708, 1, 4);
    g.rotateY(Math.PI / 4);
    const m = new THREE.Mesh(g, mat);
    m.scale.set(w, h, d);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function cyl(r, h, mat, rTop) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop ?? r, r, h, 8), mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function decal(w, h, tex, transparent = true) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      lam({ map: tex, transparent, alphaTest: transparent ? 0.05 : 0 }));
    return m;
  }
  function flatDecal(w, d, tex) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lam({ map: tex }));
    m.rotation.x = -Math.PI / 2;
    m.receiveShadow = true;
    return m;
  }
  function leafBall(r, tex) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 6), lam({ map: tex }));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  // ---------- building models ----------
  function houseModel({ w, d, wallH, wallTex, roofScale, chimney, windows }) {
    const grp = new THREE.Group();
    const wall = box(w, wallH, d, lam({ map: wallTex }));
    wall.position.y = wallH / 2;
    grp.add(wall);
    const roof = hipRoof(w * roofScale, wallH * 0.85, d * roofScale, lam({ map: TEX.roof }));
    roof.position.y = wallH + wallH * 0.425;
    grp.add(roof);
    if (chimney) {
      const ch = box(0.16, 0.55, 0.16, lam({ map: TEX.stone }));
      ch.position.set(w * 0.28, wallH + 0.45, -d * 0.18);
      grp.add(ch);
    }
    const door = decal(0.34, 0.45, TEX.door);
    door.position.set(0, 0.24, d / 2 + 0.012);
    grp.add(door);
    for (const [wx, wz, ry] of windows || []) {
      const win = decal(0.28, 0.34, TEX.window);
      win.position.set(wx, wallH * 0.55, wz);
      win.rotation.y = ry;
      grp.add(win);
    }
    return grp;
  }
  function buildModels() {
    const M = {};
    M.cottage = houseModel({
      w: 1.6, d: 1.45, wallH: 0.78, wallTex: TEX.wall, roofScale: 1.25, chimney: true,
      windows: [[-0.5, 1.45 / 2 + 0.012, 0], [0.5, 1.45 / 2 + 0.012, 0]],
    });
    M.bakery = houseModel({
      w: 1.6, d: 1.45, wallH: 0.82, wallTex: TEX.plaster, roofScale: 1.25, chimney: true,
      windows: [[-0.5, 1.45 / 2 + 0.012, 0]],
    });
    {
      const awn = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), lam({ map: TEX.awnR, side: THREE.DoubleSide }));
      awn.position.set(0.45, 0.62, 1.45 / 2 + 0.14);
      awn.rotation.x = -0.7;
      awn.castShadow = true;
      M.bakery.add(awn);
    }
    M.manor = (() => {
      const grp = houseModel({
        w: 2.55, d: 2.2, wallH: 1.05, wallTex: TEX.wall, roofScale: 1.2, chimney: true,
        windows: [
          [-0.85, 2.2 / 2 + 0.012, 0], [0.85, 2.2 / 2 + 0.012, 0],
          [-2.55 / 2 - 0.012, 0.4, -Math.PI / 2], [2.55 / 2 + 0.012, 0.4, Math.PI / 2],
        ],
      });
      const up = box(1.25, 0.55, 1.05, lam({ map: TEX.wall }));
      up.position.y = 1.05 + 0.45 + 0.27;
      grp.add(up);
      const upRoof = hipRoof(1.5, 0.6, 1.3, lam({ map: TEX.roof }));
      upRoof.position.y = 1.05 + 0.45 + 0.55 + 0.3;
      grp.add(upRoof);
      const hedge1 = leafBall(0.26, TEX.leafR), hedge2 = leafBall(0.26, TEX.leafP);
      hedge1.position.set(-1.05, 0.2, 1.0); hedge2.position.set(1.05, 0.2, 1.0);
      grp.add(hedge1, hedge2);
      return grp;
    })();
    M.farm = (() => {
      const grp = new THREE.Group();
      const f = flatDecal(2.9, 2.9, TEX.field);
      f.position.y = 0.02;
      grp.add(f);
      const pole = cyl(0.03, 0.7, lam({ map: TEX.bark }));
      pole.position.set(0.4, 0.35, 0.3);
      const arm = box(0.5, 0.05, 0.05, lam({ map: TEX.bark }));
      arm.position.set(0.4, 0.52, 0.3);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), lam({ color: C.fY }));
      head.castShadow = true;
      head.position.set(0.4, 0.68, 0.3);
      grp.add(pole, arm, head);
      return grp;
    })();
    M.lumber = (() => {
      const grp = new THREE.Group();
      const logMat = lam({ map: TEX.bark });
      const mkLog = (x, y, z) => {
        const l = cyl(0.13, 1.1, logMat);
        l.rotation.z = Math.PI / 2;
        l.position.set(x, y, z);
        return l;
      };
      grp.add(mkLog(-0.25, 0.13, 0.35), mkLog(-0.25, 0.13, 0.62), mkLog(-0.25, 0.36, 0.48));
      const stump = cyl(0.17, 0.24, logMat);
      stump.position.set(0.55, 0.12, -0.3);
      grp.add(stump);
      const axeH = box(0.04, 0.4, 0.04, lam({ map: TEX.bark }));
      axeH.position.set(0.55, 0.42, -0.3); axeH.rotation.z = 0.4;
      const axeB = box(0.16, 0.08, 0.03, lam({ map: TEX.stone }));
      axeB.position.set(0.48, 0.56, -0.3);
      grp.add(axeH, axeB);
      const planks = box(0.7, 0.16, 0.4, lam({ map: TEX.plank }));
      planks.position.set(-0.2, 0.08, -0.45);
      planks.rotation.y = 0.2;
      grp.add(planks);
      return grp;
    })();
    M.quarry = (() => {
      const grp = new THREE.Group();
      const f = flatDecal(1.9, 1.9, TEX.quarryT);
      f.position.y = 0.02;
      grp.add(f);
      const b1 = box(0.34, 0.26, 0.3, lam({ map: TEX.stone }));
      b1.position.set(-0.35, 0.13, 0.35);
      const b2 = box(0.28, 0.2, 0.26, lam({ map: TEX.stone }));
      b2.position.set(0.4, 0.1, -0.3);
      b2.rotation.y = 0.5;
      grp.add(b1, b2);
      return grp;
    })();
    M.well = (() => {
      const grp = new THREE.Group();
      const ring = cyl(0.28, 0.3, lam({ map: TEX.stone }));
      ring.position.y = 0.15;
      grp.add(ring);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.2, 10), lam({ color: '#23232b' }));
      hole.rotation.x = -Math.PI / 2;
      hole.position.y = 0.305;
      grp.add(hole);
      const p1 = box(0.05, 0.55, 0.05, lam({ map: TEX.bark }));
      p1.position.set(-0.26, 0.5, 0);
      const p2 = p1.clone(); p2.position.x = 0.26;
      grp.add(p1, p2);
      const roof = hipRoof(0.75, 0.3, 0.55, lam({ map: TEX.roof }));
      roof.position.y = 0.92;
      grp.add(roof);
      const bucket = cyl(0.07, 0.1, lam({ map: TEX.plank }), 0.06);
      bucket.position.y = 0.55;
      grp.add(bucket);
      return grp;
    })();
    M.garden = (() => {
      const grp = new THREE.Group();
      const f = flatDecal(0.92, 0.92, TEX.gardenT);
      f.position.y = 0.02;
      grp.add(f);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.07, 0.96), lam({ map: TEX.bark }));
      rim.position.y = 0.035;
      rim.receiveShadow = true;
      grp.add(rim);
      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.09, 0.84), lam({ map: TEX.gardenT }));
      inner.position.y = 0.045;
      grp.add(inner);
      return grp;
    })();
    M.market = (() => {
      const grp = new THREE.Group();
      const stall = (x, awnTex) => {
        const s = new THREE.Group();
        const counter = box(1.1, 0.4, 0.55, lam({ map: TEX.plank }));
        counter.position.y = 0.2;
        s.add(counter);
        for (const sx of [-0.5, 0.5]) for (const sz of [-0.22, 0.22]) {
          const post = box(0.05, 0.95, 0.05, lam({ map: TEX.bark }));
          post.position.set(sx, 0.48, sz);
          s.add(post);
        }
        const awn = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.75), lam({ map: awnTex, side: THREE.DoubleSide }));
        awn.position.set(0, 1.06, 0.1);
        awn.rotation.x = -Math.PI / 2 + 0.45;
        awn.castShadow = true;
        s.add(awn);
        for (let i = 0; i < 4; i++) {
          const g = box(0.1, 0.1, 0.1, lam({ color: [C.fR, C.fY, C.fO, C.leafL][i] }));
          g.position.set(-0.35 + i * 0.24, 0.45, 0.1);
          s.add(g);
        }
        s.position.x = x;
        return s;
      };
      grp.add(stall(-0.72, TEX.awnR), stall(0.72, TEX.awnG));
      const crate = box(0.32, 0.32, 0.32, lam({ map: TEX.crate }));
      crate.position.set(-0.5, 0.16, 0.95);
      const crate2 = crate.clone();
      crate2.position.set(-0.12, 0.14, 1.0);
      crate2.rotation.y = 0.4;
      crate2.scale.setScalar(0.85);
      const barrel = cyl(0.2, 0.45, lam({ map: TEX.bark }), 0.17);
      barrel.position.set(0.6, 0.22, 0.95);
      grp.add(crate, crate2, barrel);
      return grp;
    })();
    return M;
  }

  function makeGhosts() {
    const ok = lam({ color: '#6edc5a', transparent: true, opacity: 0.55 });
    const bad = lam({ color: '#dc4632', transparent: true, opacity: 0.55 });
    const out = {};
    for (const k in models) {
      const gOk = models[k].clone(true), gBad = models[k].clone(true);
      gOk.traverse(o => { if (o.isMesh) { o.material = ok; o.castShadow = false; o.receiveShadow = false; } });
      gBad.traverse(o => { if (o.isMesh) { o.material = bad; o.castShadow = false; o.receiveShadow = false; } });
      out[k] = { ok: gOk, bad: gBad };
    }
    return out;
  }

  // tree/rock scatter models
  function treeModel(variant) {
    const grp = new THREE.Group();
    const trunk = cyl(0.07, 0.3, lam({ map: TEX.bark }));
    trunk.position.y = 0.15;
    grp.add(trunk);
    const tex = [TEX.leafR, TEX.leafP, TEX.leaf, TEX.leaf][variant % 4];
    const b1 = leafBall(0.34, tex); b1.position.y = 0.5;
    const b2 = leafBall(0.24, tex); b2.position.set(0.08, 0.74, 0.05);
    grp.add(b1, b2);
    return grp;
  }
  function rockModel(variant) {
    const grp = new THREE.Group();
    const mat = lam({ map: TEX.stone });
    const r1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.26, 0), mat);
    r1.position.y = 0.14; r1.scale.y = 0.7; r1.rotation.y = variant;
    r1.castShadow = true; r1.receiveShadow = true;
    const r2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15, 0), mat);
    r2.position.set(0.25, 0.09, 0.18); r2.scale.y = 0.65; r2.rotation.y = variant * 2.1;
    r2.castShadow = true; r2.receiveShadow = true;
    grp.add(r1, r2);
    return grp;
  }

  // ---------- world/tile mapping ----------
  function tileToWorld(tx, ty, w = 1, h = 1) {
    return new THREE.Vector3(tx + w / 2 - COLS / 2, 0, ty + h / 2 - ROWS / 2);
  }

  // ---------- scene setup ----------
  function init(container) {
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    dom = renderer.domElement;
    dom.id = 'game';
    container.appendChild(dom);

    scene = new THREE.Scene();
    scene.background = new THREE.Color('#a8c4d8');
    scene.fog = new THREE.Fog('#a8c4d8', 55, 110);

    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200);

    ambient = new THREE.AmbientLight('#fff2dd', 0.55);
    hemi = new THREE.HemisphereLight('#cfe5ff', '#7a6a4d', 0.35);
    sun = new THREE.DirectionalLight('#ffe9c0', 1.25);
    sun.position.set(18, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 18; sc.bottom = -18;
    sc.near = 5; sc.far = 80;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    scene.add(ambient, hemi, sun, sun.target);

    buildTextures();

    // ground
    groundCanvas = document.createElement('canvas');
    groundCanvas.width = COLS * TILE; groundCanvas.height = ROWS * TILE;
    groundCtx = groundCanvas.getContext('2d');
    groundTex = new THREE.CanvasTexture(groundCanvas);
    groundTex.magFilter = THREE.NearestFilter;
    groundTex.minFilter = THREE.NearestFilter;
    groundTex.colorSpace = THREE.SRGBColorSpace;
    const gGeo = new THREE.PlaneGeometry(COLS, ROWS);
    gGeo.rotateX(-Math.PI / 2);
    groundMesh = new THREE.Mesh(gGeo, lam({ map: groundTex }));
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    scatterGroup = new THREE.Group();
    buildingGroup = new THREE.Group();
    scene.add(scatterGroup, buildingGroup);

    models = buildModels();
    ghostModels = makeGhosts();

    // highlight quads
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

  // ---------- terrain ----------
  function rebuildTerrain() {
    const g = groundCtx;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = state.terrain[y][x], h = hash2(x, y);
      if (t === T_GROUND) g.drawImage(SPR.ground[h % SPR.ground.length], x * TILE, y * TILE);
      else if (t === T_PATH) g.drawImage(SPR.path, x * TILE, y * TILE);
      else g.drawImage(SPR.grass[h % SPR.grass.length], x * TILE, y * TILE);
    }
    groundTex.needsUpdate = true;
    // scatter
    scatterGroup.clear();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = state.terrain[y][x], h = hash2(x, y);
      if (t !== T_TREE && t !== T_ROCK) continue;
      const m = t === T_TREE ? treeModel(h % 4) : rockModel((h % 7) * 0.9);
      m.position.copy(tileToWorld(x, y));
      const s = 0.85 + (h % 31) / 100;
      m.scale.setScalar(s);
      m.rotation.y = (h % 13) * 0.48;
      scatterGroup.add(m);
    }
  }

  // ---------- buildings ----------
  function syncBuildings() {
    const seen = new Set();
    for (const b of state.buildings) {
      seen.add(b);
      if (!meshByBuilding.has(b)) {
        const def = DEFS[b.type];
        const m = models[b.type].clone(true);
        m.position.copy(tileToWorld(b.x, b.y, def.w, def.h));
        buildingGroup.add(m);
        meshByBuilding.set(b, m);
      }
    }
    for (const [b, m] of meshByBuilding) {
      if (!seen.has(b)) { buildingGroup.remove(m); meshByBuilding.delete(b); }
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

  // ---------- camera controls ----------
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
      zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0012), 0.55, 5);
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
        pitch = clamp(pitch - dy * 0.004, 0.42, 1.45); // drag down → lower toward horizon
      } else {
        // pan in camera-aligned ground directions
        const s = 0.026 / zoom;
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        target.x -= (dx * cy - dy * sy) * s;
        target.z -= (-dx * sy - dy * cy) * s;
        target.x = clamp(target.x, -COLS / 2, COLS / 2);
        target.z = clamp(target.z, -ROWS / 2, ROWS / 2);
      }
    });
    const endDrag = e => {
      if (dragBtn >= 0 && e.button === dragBtn) dragBtn = -1;
    };
    dom.addEventListener('pointerup', endDrag);
    dom.addEventListener('pointercancel', () => { dragBtn = -1; });
  }
  function wasDragging() { const d = didDrag; didDrag = false; return d; }
  function isDragging() { return dragBtn >= 0; }

  // ---------- day/night ----------
  const _dayBg = new THREE.Color('#a8c4d8'), _nightBg = new THREE.Color('#1c2240');
  const _duskBg = new THREE.Color('#c98a5a'), _bg = new THREE.Color();
  function updateDayNight(tod) {
    const bright = 0.5 - 0.5 * Math.cos(2 * Math.PI * tod); // 0 midnight → 1 noon
    const dusk = Math.max(0, 1 - Math.abs(tod - 0.80) * 9) + Math.max(0, 1 - Math.abs(tod - 0.22) * 9);
    _bg.copy(_nightBg).lerp(_dayBg, bright).lerp(_duskBg, clamp(dusk * 0.55, 0, 0.6));
    scene.background = _bg;
    scene.fog.color.copy(_bg);
    sun.intensity = 0.15 + bright * 1.15;
    ambient.intensity = 0.22 + bright * 0.38;
    hemi.intensity = 0.12 + bright * 0.26;
    const ang = (tod - 0.5) * Math.PI; // sun swings east→west
    sun.position.set(Math.sin(ang) * 26 + 6, 14 + bright * 18, 12);
  }

  // ---------- per-frame ----------
  function frame(tod) {
    applyCamera();
    updateDayNight(tod);
    renderer.render(scene, camera);
  }
  function onResize() {
    const w = dom.parentElement.clientWidth, h = dom.parentElement.clientHeight;
    renderer.setSize(w, h);
    const asp = w / h;
    camera.left = -VIEW * asp; camera.right = VIEW * asp;
    camera.top = VIEW; camera.bottom = -VIEW;
    camera.updateProjectionMatrix();
  }
  function zoomBy(f) { zoom = clamp(zoom * f, 0.55, 5); }

  return {
    init, rebuildTerrain, syncBuildings, setPreview, setDemolishHover, setHoverOutline,
    pick, projectTile, frame, onResize, wasDragging, isDragging, zoomBy,
    get dom() { return dom; },
  };
})();
