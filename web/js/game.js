/* game.js — 3D 数值门跑酷
   流程：整备（花兵力换强化）→ 跑位抢数值门 → 兵线对撞 → 结算 → 下一关 */
(function () {
  'use strict';

  /* ================= 配置 ================= */
  const CFG = {
    RUN_SPEED: 12.5,
    BATTLE_SPEED: 6.5,
    STANDOFF: 6.5,
    WAVE_TRIGGER: 30,
    LANE: 3.5,
    GAP_X: 0.46,
    GAP_Z: 0.54,
    MAX_UNITS: 300,
    PLAYER_HP: 13,
    BASE_START: 5,
    LEVEL_BONUS: 8,
    SHIELD_PER: 14
  };

  const WEAPON = {
    normal: { name: '普通步枪', dps: 3.2, range: 10, splash: 0, col: [1, 0.66, 0.10], flash: 0.34 },
    ranged: { name: '远程步枪', dps: 4.4, range: 26, splash: 0, col: [0.20, 0.80, 1.0], flash: 0.42 },
    rpg: { name: '火箭筒', dps: 9.0, range: 16, splash: 3, col: [1, 0.30, 0.06], flash: 0.62 }
  };

  const TYPE = {
    grunt: { hp: 16, dps: 1.25, scale: 1.0, speed: 4.4 },
    elite: { hp: 74, dps: 4.2, scale: 1.45, speed: 3.9 },
    boss: { hp: 4200, dps: 26, scale: 1.28, speed: 2.6 }
  };

  const OPTIONS = [
    {
      id: 'shield', name: '护盾', ico: '盾', color: '#1e9fd8', cost: 0.30,
      desc: '剩下的人每人 +' + CFG.SHIELD_PER + ' 护盾，先扣盾再死人'
    },
    {
      id: 'ranged', name: '远程枪', ico: '远', color: '#7a5cff', cost: 0.50,
      desc: '射程 26 米，敌人刚出现就开火，全程多打两秒'
    },
    {
      id: 'rpg', name: '火箭筒', ico: '炮', color: '#e8552a', cost: 0.75, minCount: 12,
      desc: '一发同时打 3 个，单兵伤害近 3 倍'
    }
  ];

  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  const rnd = function (a, b) { return a + Math.random() * (b - a); };

  function formationCols(n) {
    return Math.max(5, Math.min(14, Math.round(Math.sqrt(Math.max(1, n)) * 1.6)));
  }

  /* ================= 音效（WebAudio 合成） ================= */
  const audio = (function () {
    let ctx = null, master = null, lastShot = 0, noise = null;

    function ensure() {
      if (ctx) return ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);

      const len = Math.floor(ctx.sampleRate * 0.35);
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return ctx;
    }

    function unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') c.resume();
    }

    function now() { return ctx ? ctx.currentTime : 0; }

    function tone(freq, freq2, dur, type, vol, delay) {
      if (!ctx) return;
      const t = now() + (delay || 0);
      const o = ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (freq2) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }

    function burst(freq, q, dur, vol) {
      if (!ctx || !noise) return;
      const t = now();
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur + 0.02);
    }

    return {
      unlock: unlock,
      shot: function () {
        if (!ctx) return;
        const t = now();
        if (t - lastShot < 0.055) return;
        lastShot = t;
        burst(1500 + Math.random() * 500, 1.1, 0.05, 0.05);
      },
      boom: function () {
        if (!ctx) return;
        tone(120, 38, 0.34, 'sine', 0.20);
        burst(420, 0.7, 0.28, 0.16);
      },
      kill: function () {
        if (!ctx) return;
        tone(240, 90, 0.12, 'triangle', 0.09);
      },
      gateGood: function () {
        if (!ctx) return;
        tone(680, 680, 0.10, 'sine', 0.12);
        tone(1020, 1020, 0.16, 'sine', 0.10, 0.08);
      },
      shieldUp: function () {
        if (!ctx) return;
        tone(280, 920, 0.34, 'triangle', 0.13);
        burst(2600, 2.5, 0.30, 0.05);
      },
      weaponUp: function () {
        if (!ctx) return;
        tone(880, 880, 0.07, 'square', 0.10);
        tone(1320, 1760, 0.22, 'square', 0.08, 0.06);
      },
      shieldHit: function () {
        if (!ctx) return;
        burst(900, 3.2, 0.09, 0.09);
      },
      roar: function () {
        if (!ctx) return;
        tone(150, 46, 0.85, 'sawtooth', 0.20);
        tone(74, 38, 0.9, 'square', 0.10);
        burst(340, 0.8, 0.7, 0.12);
      },
      stomp: function () {
        if (!ctx) return;
        tone(90, 34, 0.32, 'sine', 0.22);
        burst(220, 0.7, 0.25, 0.14);
      },
      pick: function () {
        if (!ctx) return;
        tone(520, 780, 0.12, 'triangle', 0.10);
      },
      win: function () {
        if (!ctx) return;
        [523, 659, 784, 1046].forEach(function (f, i) {
          tone(f, f, 0.3, 'triangle', 0.11, i * 0.11);
        });
      },
      lose: function () {
        if (!ctx) return;
        [392, 330, 262, 196].forEach(function (f, i) {
          tone(f, f, 0.35, 'triangle', 0.11, i * 0.13);
        });
      }
    };
  })();

  /* ================= 渲染基础 ================= */
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.NoToneMapping;

  if (THREE.ColorManagement) {
    if ('enabled' in THREE.ColorManagement) THREE.ColorManagement.enabled = true;
    if ('legacyMode' in THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc2ddf4, 40, 100);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(230, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xc2ddf4, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  sky.renderOrder = -1;
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 280);
  camera.position.set(0, 3.6, 7.8);

  window.addEventListener('resize', function () {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  scene.add(new THREE.HemisphereLight(0xdcf0ff, 0x8ba0b0, 0.55));

  const sun = new THREE.DirectionalLight(0xfff3df, 1.15);
  sun.position.set(-8, 15, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 62;
  sun.shadow.bias = -0.0009;
  sun.shadow.radius = 2;
  scene.add(sun);
  scene.add(sun.target);

  const rim = new THREE.DirectionalLight(0xb4d4ff, 0.30);
  rim.position.set(9, 5, -14);
  scene.add(rim);

  /* ================= 程序化贴图 ================= */
  function makeGroundTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#cbdceb';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = 'rgba(120,150,178,0.035)';
      g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 26, 0, 6.284); g.fill();
    }
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = 'rgba(110,140,170,' + (0.10 + Math.random() * 0.16).toFixed(3) + ')';
      g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, Math.random() * 1.7 + 0.35, 0, 6.284); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(34, 68);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    return t;
  }

  function makeRoadTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#e9f1f8';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#d3dfea';
    g.fillRect(3, 0, 3, 128);
    g.fillRect(122, 0, 3, 128);
    g.fillStyle = '#e4ecf3';
    g.fillRect(61, 14, 6, 52);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 60);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    return t;
  }

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 520),
    new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 0.98, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -210);
  ground.receiveShadow = true;
  scene.add(ground);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 520),
    new THREE.MeshStandardMaterial({ map: makeRoadTexture(), roughness: 0.94, metalness: 0 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.006, -210);
  road.receiveShadow = true;
  scene.add(road);

  /* ================= Rig ================= */
  const playerRig = new Units.Rig('blue', CFG.MAX_UNITS).addTo(scene);
  const gruntRig = new Units.Rig('red', 170).addTo(scene);
  const eliteRig = new Units.Rig('elite', 40).addTo(scene);
  const bossRig = new Units.Rig('boss', 3).addTo(scene);

  /* ================= 子弹（真实飞行 + 命中火花） ================= */
  const glowTex = Units.glowTexture();

  const BMAX = 150;
  const TPOINT = 3;                       // 每发子弹画 3 个点，拖出弹道
  const bPos = new Float32Array(BMAX * TPOINT * 3);
  const bCol = new Float32Array(BMAX * TPOINT * 3);
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  bGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
  bGeo.setDrawRange(0, 0);
  const bPts = new THREE.Points(bGeo, new THREE.PointsMaterial({
    size: 0.55, map: glowTex, transparent: true, depthWrite: false,
    vertexColors: true, sizeAttenuation: true
  }));
  bPts.frustumCulled = false;
  bPts.renderOrder = 7;
  scene.add(bPts);

  const bullets = [];

  function fireBullet(sx, sy, sz, tx, ty, tz, r, g, b, dur) {
    if (bullets.length >= BMAX) bullets.shift();
    bullets.push({ x: sx, y: sy, z: sz, tx: tx, ty: ty, tz: tz, t: 0, dur: dur, r: r, g: g, b: b });
  }

  const SMAX = 220;
  const sPos = new Float32Array(SMAX * 3);
  const sCol = new Float32Array(SMAX * 3);
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  sGeo.setDrawRange(0, 0);
  const sPts = new THREE.Points(sGeo, new THREE.PointsMaterial({
    size: 0.24, map: glowTex, transparent: true, depthWrite: false,
    vertexColors: true, sizeAttenuation: true
  }));
  sPts.frustumCulled = false;
  sPts.renderOrder = 7;
  scene.add(sPts);

  const sparksArr = [];

  function spawnSparks(x, y, z, count, r, g, b) {
    for (let i = 0; i < count; i++) {
      if (sparksArr.length >= SMAX) sparksArr.shift();
      sparksArr.push({
        x: x, y: y, z: z,
        vx: rnd(-2.4, 2.4), vy: rnd(0.8, 4.2), vz: rnd(-2.4, 2.4),
        life: rnd(0.16, 0.30), max: 0.30, r: r, g: g, b: b
      });
    }
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.t += dt;
      if (b.t >= b.dur) {
        spawnSparks(b.tx, b.ty, b.tz, 2, b.r, b.g, b.b);
        bullets.splice(i, 1);
      }
    }
    let n = 0;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      const k = b.t / b.dur;
      for (let j = 0; j < TPOINT; j++) {
        const kk = clamp(k - j * 0.14, 0, 1);
        const f = 1 - j * 0.34;
        bPos[n * 3] = b.x + (b.tx - b.x) * kk;
        bPos[n * 3 + 1] = b.y + (b.ty - b.y) * kk;
        bPos[n * 3 + 2] = b.z + (b.tz - b.z) * kk;
        bCol[n * 3] = b.r * f; bCol[n * 3 + 1] = b.g * f; bCol[n * 3 + 2] = b.b * f;
        n++;
      }
    }
    bGeo.setDrawRange(0, n);
    bGeo.attributes.position.needsUpdate = true;
    bGeo.attributes.color.needsUpdate = true;
  }

  function updateSparks(dt) {
    for (let i = sparksArr.length - 1; i >= 0; i--) {
      const s = sparksArr[i];
      s.life -= dt;
      if (s.life <= 0) { sparksArr.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      s.vy -= 9 * dt;
      if (s.y < 0.04) { s.y = 0.04; s.vy *= -0.32; s.vx *= 0.6; s.vz *= 0.6; }
    }
    let n = 0;
    for (let i = 0; i < sparksArr.length && n < SMAX; i++) {
      const s = sparksArr[i];
      const k = clamp(s.life / s.max, 0, 1);
      sPos[n * 3] = s.x; sPos[n * 3 + 1] = s.y; sPos[n * 3 + 2] = s.z;
      sCol[n * 3] = s.r * k; sCol[n * 3 + 1] = s.g * k; sCol[n * 3 + 2] = s.b * k;
      n++;
    }
    sGeo.setDrawRange(0, n);
    sGeo.attributes.position.needsUpdate = true;
    sGeo.attributes.color.needsUpdate = true;
  }

  /* ================= 枪口火光 ================= */
  const flashTex = (function () {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,244,200,1)');
    grd.addColorStop(0.32, 'rgba(255,206,96,0.9)');
    grd.addColorStop(1, 'rgba(255,150,30,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  })();

  const flashPool = [];
  for (let i = 0; i < 26; i++) {
    const m = new THREE.SpriteMaterial({
      map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const sp = new THREE.Sprite(m);
    sp.visible = false;
    sp.renderOrder = 6;
    scene.add(sp);
    flashPool.push({ sp: sp, t: 0 });
  }
  let flashIdx = 0;

  function mflash(x, y, z, size) {
    const f = flashPool[flashIdx++ % flashPool.length];
    f.sp.position.set(x, y, z);
    f.sp.scale.setScalar(size);
    f.sp.material.opacity = 1;
    f.sp.visible = true;
    f.t = 0.065;
  }

  function updateFlashes(dt) {
    for (let i = 0; i < flashPool.length; i++) {
      const f = flashPool[i];
      if (!f.sp.visible) continue;
      f.t -= dt;
      if (f.t <= 0) { f.sp.visible = false; continue; }
      f.sp.material.opacity = f.t / 0.065;
      f.sp.scale.setScalar(f.sp.scale.x * 1.04);
    }
  }

  /* ================= 精英榴弹 ================= */
  const grenadeGeo = new THREE.SphereGeometry(0.10, 8, 6);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x5b6b33, emissive: 0x3a2200, roughness: 0.55 });
  const grenades = [];
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(grenadeGeo, grenadeMat);
    m.visible = false;
    scene.add(m);
    grenades.push({ mesh: m, active: false, t: 0, dur: 1, sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, arc: 0, dmg: 0 });
  }

  /* ================= 首领核心 / 激光 ================= */
  const bossCore = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffa055, transparent: true, depthWrite: false, opacity: 1
  }));
  bossCore.scale.set(0.42, 0.42, 1);
  bossCore.visible = false;
  scene.add(bossCore);

  const bossGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xff8a4a, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75
  }));
  bossGlow.scale.set(0.62, 0.62, 1);
  bossGlow.visible = false;
  scene.add(bossGlow);

  /* 激光：沿弹道铺一串光点，任意角度都不会露出几何体硬边 */
  const BEAM_N = 22;
  const beamNodes = [];
  const BEAM_OUT = new THREE.Color(0xff4a10);
  const BEAM_IN = new THREE.Color(0xfff0c0);
  for (let i = 0; i < BEAM_N; i++) {
    const t = i / (BEAM_N - 1);
    const mat = new THREE.SpriteMaterial({
      map: glowTex,
      color: BEAM_OUT.clone().lerp(BEAM_IN, Math.sin(t * Math.PI)),
      transparent: true, depthWrite: false, opacity: 0
    });
    const sp = new THREE.Sprite(mat);
    sp.visible = false;
    sp.renderOrder = 8;
    scene.add(sp);
    beamNodes.push(sp);
  }

  const beamHit = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffd9a0, transparent: true, depthWrite: false, opacity: 0
  }));
  beamHit.visible = false;
  beamHit.renderOrder = 9;
  scene.add(beamHit);

  const _bFrom = new THREE.Vector3();
  const _bTo = new THREE.Vector3();

  function hideBeam() {
    for (let i = 0; i < BEAM_N; i++) beamNodes[i].visible = false;
    beamHit.visible = false;
  }

  const gateGroup = new THREE.Group();
  scene.add(gateGroup);
  const fxGroup = new THREE.Group();
  scene.add(fxGroup);

  /* 护盾罩 */
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 22, 14),
    new THREE.MeshBasicMaterial({
      color: 0x6fd6ff, transparent: true, opacity: 0.12,
      depthWrite: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending
    })
  );
  dome.visible = false;
  scene.add(dome);

  /* 首领踏地冲击波 */
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 40),
    new THREE.MeshBasicMaterial({
      color: 0xff8a5c, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  let ringT = 1;

  /* ================= 数值门 ================= */
  function gateColor(spec) {
    if (spec.op === '×') return '#1fb85c';
    if (spec.op === '+') return '#2f6ee0';
    if (spec.op === '-') return '#e0553f';
    return '#8b5cf6';
  }

  function gateText(spec) { return spec.op + spec.v; }

  function finishTexture(c) {
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  function makeGateTexture(spec) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 384;
    const g = c.getContext('2d');
    const hex = gateColor(spec);

    const grd = g.createLinearGradient(0, 0, 0, 384);
    grd.addColorStop(0, hex + 'f5');
    grd.addColorStop(1, hex + 'bc');
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 384);

    g.strokeStyle = 'rgba(255,255,255,.96)';
    g.lineWidth = 12;
    g.strokeRect(16, 16, 480, 352);

    const label = gateText(spec);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';

    let size = 210;
    g.font = 'bold ' + size + 'px "Segoe UI", system-ui, sans-serif';
    while (g.measureText(label).width > 420 && size > 64) {
      size -= 8;
      g.font = 'bold ' + size + 'px "Segoe UI", system-ui, sans-serif';
    }
    g.fillText(label, 256, 198);
    return finishTexture(c);
  }

  function makePanel(spec, x) {
    const mat = new THREE.MeshBasicMaterial({ map: makeGateTexture(spec), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.9), mat);
    mesh.position.set(x, 1.65, 0);
    return mesh;
  }

  const postGeo = new THREE.BoxGeometry(0.10, 3.10, 0.10);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf6fafd, roughness: 0.5 });

  function createGate(z, left, right) {
    const group = new THREE.Group();
    group.position.z = z;

    const pL = makePanel(left, -1.82);
    const pR = makePanel(right, 1.82);
    group.add(pL, pR);

    const postX = [-3.55, -0.09, 0.09, 3.55];
    for (let i = 0; i < postX.length; i++) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(postX[i], 1.55, 0.02);
      post.castShadow = true;
      group.add(post);
    }

    gateGroup.add(group);
    return { z: z, left: left, right: right, done: false, anim: 0, group: group };
  }

  function clearGates() {
    const kids = gateGroup.children.slice();
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i];
      g.traverse(function (o) {
        if (o.geometry && o.geometry !== postGeo) o.geometry.dispose();
        if (o.material && o.material !== postMat) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
      gateGroup.remove(g);
    }
  }

  /* ================= 关卡 ================= */
  function buildLevel(n) {
    const k = 1 + (n - 1) * 0.35;
    const plan = [
      { g: [{ op: '+', v: 6 }, { op: '×', v: 2 }], w: { grunt: 6 } },
      { g: [{ op: '+', v: 14 }, { op: '×', v: 3 }], w: { grunt: 8, elite: 1 } },
      { g: [{ op: '×', v: 2 }, { op: '+', v: 45 }], w: { grunt: 10, elite: 2 } },
      { g: [{ op: '+', v: 30 }, { op: '×', v: 3 }], w: { grunt: 12, elite: 3, boss: 1 } }
    ];
    if (n >= 2) plan[0].g[0] = { op: '-', v: 4 };
    if (n >= 3) plan[1].g[1] = { op: '-', v: 12 };

    const gates = [];
    const waves = [];
    let z = -24;

    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      gates.push(createGate(z, p.g[0], p.g[1]));
      z -= 45;
      waves.push({
        z: z,
        comp: {
          grunt: Math.round((p.w.grunt || 0) * k),
          elite: Math.round((p.w.elite || 0) * k),
          boss: p.w.boss || 0
        },
        started: false,
        done: false
      });
      z -= 26;
    }
    return { gates: gates, waves: waves };
  }

  /* ================= 状态 ================= */
  const S = {
    phase: 'loadout',
    level: 1,
    startCount: CFG.BASE_START,
    playerX: 0,
    targetX: 0,
    vx: 0,
    playerZ: 0,
    count: CFG.BASE_START,
    hpAcc: 0,
    wave: null,
    levelData: null,
    volleyAcc: 0,
    resumeAt: 0,
    shake: 0,
    shieldLeft: 0,
    shieldFlash: 0,
    weapon: 'normal',
    stompAt: 0
  };

  let units = [];
  let enemies = [];
  let popups = [];
  const scratch = [];

  const LIMIT = { grunt: 170, elite: 40, boss: 3 };
  const foeItems = { grunt: [], elite: [], boss: [] };
  const blueItems = [];
  for (let i = 0; i < CFG.MAX_UNITS; i++) blueItems.push({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, swing: 0 });
  for (const k in foeItems) {
    for (let i = 0; i < LIMIT[k]; i++) foeItems[k].push({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, swing: 0 });
  }

  /* ================= HUD ================= */
  const elCount = document.getElementById('count');
  const elLv = document.getElementById('lv');
  const elFoes = document.getElementById('foes');
  const elWep = document.getElementById('wep');
  const elShl = document.getElementById('shl');
  const elBossBar = document.getElementById('bossbar');
  const elBossFill = document.getElementById('bossfill');
  const elHint = document.getElementById('hint');
  const elOverlay = document.getElementById('overlay');
  const elOvTitle = document.getElementById('ovTitle');
  const elOvSub = document.getElementById('ovSub');
  const elOvBtn = document.getElementById('ovBtn');
  const elFlash = document.getElementById('flash');

  function screenFlash(op, color) {
    elFlash.style.background = color || '#ffb060';
    elFlash.style.transition = 'none';
    elFlash.style.opacity = String(op);
    requestAnimationFrame(function () {
      elFlash.style.transition = 'opacity .40s ease-out';
      elFlash.style.opacity = '0';
    });
  }

  const elLoadout = document.getElementById('loadout');
  const elLoLv = document.getElementById('loLv');
  const elLoCount = document.getElementById('loCount');
  const elLoNote = document.getElementById('loNote');
  const elLoOpts = document.getElementById('loOpts');
  const elLoSkip = document.getElementById('loSkip');

  let lastShown = -1;
  let lastFoes = -1;
  let wepShown = '';
  let shlShown = -1;

  function updateHud() {
    if (S.count !== lastShown) {
      elCount.textContent = S.count;
      elCount.classList.remove('pop');
      void elCount.offsetWidth;
      elCount.classList.add('pop');
      lastShown = S.count;
    }

    let alive = 0, boss = null;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      alive++;
      if (e.type === 'boss') boss = e;
    }
    if (alive !== lastFoes) { elFoes.textContent = alive; lastFoes = alive; }

    const wname = WEAPON[S.weapon].name;
    if (S.weapon !== 'normal') {
      elWep.classList.remove('hide');
      if (wepShown !== wname) { elWep.textContent = wname; wepShown = wname; }
    } else elWep.classList.add('hide');

    if (S.shieldLeft > 0) {
      elShl.classList.remove('hide');
      const v = Math.ceil(S.shieldLeft);
      if (shlShown !== v) {
        elShl.innerHTML = '护盾 <b>' + v + '</b>';
        shlShown = v;
      }
    } else elShl.classList.add('hide');

    elLv.textContent = S.level;

    if (boss) {
      elBossBar.classList.remove('hide');
      elBossFill.style.width = Math.max(0, (boss.hp / boss.maxHp) * 100) + '%';
    } else {
      elBossBar.classList.add('hide');
    }
  }

  function showOverlay(title, sub, btn, fn) {
    elOvTitle.textContent = title;
    elOvSub.textContent = sub;
    elOvBtn.textContent = btn;
    elOverlay.classList.remove('hide');
    elOvBtn.onclick = fn;
  }

  /* ================= 整备 ================= */
  function costOf(count, pct) {
    return clamp(Math.round(count * pct), 1, Math.max(1, count - 1));
  }

  function renderLoadout(isNext) {
    elLoLv.textContent = '第 ' + S.level + ' 关';
    elLoCount.textContent = S.startCount;
    elLoNote.textContent = isNext ? '过关奖励 +' + CFG.LEVEL_BONUS + ' 初始兵力' : '';
    elLoNote.style.display = isNext ? 'block' : 'none';

    elLoOpts.innerHTML = '';
    OPTIONS.forEach(function (opt) {
      const cost = costOf(S.startCount, opt.cost);
      const rest = Math.max(1, S.startCount - cost);
      const locked = opt.minCount ? S.startCount < opt.minCount : false;

      const btn = document.createElement('button');
      btn.className = 'opt' + (locked ? ' disabled' : '');
      btn.innerHTML =
        '<span class="opt-ico" style="background:' + opt.color + '">' + opt.ico + '</span>' +
        '<span class="opt-name">' + opt.name + '</span>' +
        '<span class="opt-desc">' + opt.desc + '</span>' +
        (locked
          ? '<span class="opt-cost">需 ' + opt.minCount + ' 人解锁</span>'
          : '<span class="opt-cost">-' + cost + ' 人</span><span class="opt-gain">剩 ' + rest + '</span>');
      if (!locked) {
        btn.onclick = function () {
          audio.unlock();
          audio.pick();
          startRun(opt.id);
        };
      }
      elLoOpts.appendChild(btn);
    });

    elLoSkip.onclick = function () {
      audio.unlock();
      audio.pick();
      startRun('none');
    };

    elLoadout.classList.remove('hide');
  }

  function startRun(id) {
    const cost = id === 'none' ? 0 : costOf(S.startCount, OPTIONS.find(function (o) { return o.id === id; }).cost);
    S.count = Math.max(1, S.startCount - cost);

    S.weapon = 'normal';
    S.shieldLeft = 0;

    if (id === 'shield') {
      S.shieldLeft = S.count * CFG.SHIELD_PER;
      audio.shieldUp();
    } else if (id === 'ranged') {
      S.weapon = 'ranged';
      audio.weaponUp();
    } else if (id === 'rpg') {
      S.weapon = 'rpg';
      audio.weaponUp();
    }

    syncCrowd();
    elLoadout.classList.add('hide');
    elHint.style.opacity = '1';
    S.phase = 'run';
    updateHud();
  }

  /* ================= 人数 ================= */
  function syncCrowd() {
    while (units.length < S.count) {
      units.push({
        spawn: elapsed,
        ph: Math.random() * 6.28,
        jx: (Math.random() - 0.5) * 0.22,
        jz: (Math.random() - 0.5) * 0.16
      });
    }
    while (units.length > S.count) units.pop();
  }

  function applyOp(spec) {
    if (spec.op === '+') S.count += spec.v;
    else if (spec.op === '-') S.count = Math.max(1, S.count - spec.v);
    else if (spec.op === '×') S.count = Math.round(S.count * spec.v);
    else if (spec.op === '÷') S.count = Math.max(1, Math.floor(S.count / spec.v));

    S.count = clamp(S.count, 1, CFG.MAX_UNITS);
    syncCrowd();
    if (S.shieldLeft > 0) S.shieldLeft = S.count * CFG.SHIELD_PER;
  }

  /* ================= 飘字 ================= */
  function makePopupTexture(text, hex) {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 128;
    const g = c.getContext('2d');
    g.font = 'bold 76px "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 13;
    g.strokeStyle = 'rgba(255,255,255,.96)';
    g.strokeText(text, 160, 66);
    g.fillStyle = hex;
    g.fillText(text, 160, 66);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function spawnPopup(x, z, text, hex) {
    const mat = new THREE.SpriteMaterial({
      map: makePopupTexture(text, hex), transparent: true, depthTest: false
    });
    const sp = new THREE.Sprite(mat);
    sp.position.set(x, 2.2, z);
    sp.scale.set(2.6, 1.04, 1);
    sp.renderOrder = 20;
    fxGroup.add(sp);
    popups.push({ sp: sp, t: 0 });
  }

  /* ================= 敌人 ================= */
  function spawnWave(wave) {
    enemies.length = 0;
    const z0 = wave.z;

    const ng = Math.min(wave.comp.grunt, LIMIT.grunt);
    const cols = 9;
    for (let i = 0; i < ng; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const rowN = Math.min(cols, ng - r * cols);
      enemies.push({
        type: 'grunt', alive: true, hp: TYPE.grunt.hp, maxHp: TYPE.grunt.hp,
        x: (c - (rowN - 1) / 2) * 0.62 + rnd(-0.09, 0.09),
        z: z0 - r * 0.62,
        ph: Math.random() * 6.28, dieT: 0
      });
    }

    const ne = Math.min(wave.comp.elite, LIMIT.elite);
    for (let i = 0; i < ne; i++) {
      const side = i % 2 ? 1 : -1;
      const lane = Math.floor(i / 2);
      enemies.push({
        type: 'elite', alive: true, hp: TYPE.elite.hp, maxHp: TYPE.elite.hp,
        x: side * (1.55 + lane * 0.85) + rnd(-0.1, 0.1),
        z: z0 - 1.3 - lane * 0.6,
        ph: Math.random() * 6.28, dieT: 0
      });
    }

    if (wave.comp.boss) {
      enemies.push({
        type: 'boss', alive: true, hp: TYPE.boss.hp, maxHp: TYPE.boss.hp,
        x: 0, z: z0 - 4.2, ph: 0, dieT: 0
      });
      audio.roar();
      S.shake = Math.max(S.shake, 0.3);
      S.stompAt = elapsed + 1.2;
    }

    S.wave = wave;
    S.phase = 'battle';
  }

  function aliveCount() {
    let c = 0;
    for (let i = 0; i < enemies.length; i++) if (enemies[i].alive) c++;
    return c;
  }

  function nearestDist() {
    let d = 1e9;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      const dd = S.playerZ - e.z;
      if (dd < d) d = dd;
    }
    return d;
  }

  function damagePlayer(amount) {
    if (S.shieldLeft > 0 && amount > 0) {
      const take = Math.min(S.shieldLeft, amount);
      S.shieldLeft -= take;
      amount -= take;
      S.shieldFlash = 0.3;
      audio.shieldHit();
    }
    if (amount <= 0) return;

    S.hpAcc += amount;
    while (S.hpAcc >= CFG.PLAYER_HP && S.count > 0) {
      S.hpAcc -= CFG.PLAYER_HP;
      S.count--;
      units.pop();
      S.shake = Math.min(0.16, S.shake + 0.025);
    }
    if (S.count <= 0) {
      S.count = 0;
      S.shieldLeft = 0;
      gameOver();
    }
  }

  function hitEnemy(e, dmg, splash) {
    if (!e.alive || dmg <= 0) return dmg;
    const take = Math.min(dmg, e.hp);
    e.hp -= take;
    dmg -= take;
    if (e.hp <= 0) {
      e.alive = false;
      e.dieT = 0.32;
      S.shake = Math.min(0.14, S.shake + (e.type === 'boss' ? 0.35 : 0.006));
      if (e.type === 'boss') audio.roar();
      else if (Math.random() < 0.3) audio.kill();
      if (splash) mflash(e.x, 0.9, e.z, 1.15);
    }
    return dmg;
  }

  /* ================= 战斗 ================= */
  const VOLLEY = 0.06;

  /* 前排各自找最近的目标开火：不集火，伤害摊到整条兵线 */
  function playerVolley(w) {
    const n = units.length;
    if (n <= 0) return;

    scratch.length = 0;
    for (let i = 0; i < enemies.length; i++) if (enemies[i].alive) scratch.push(enemies[i]);
    if (!scratch.length) return;
    scratch.sort(function (a, b) { return b.z - a.z; });

    const shooters = Math.min(formationCols(n), n, scratch.length);
    const per = (n * w.dps * VOLLEY) / shooters;
    const M = Units.MUZZLE;

    for (let i = 0; i < shooters; i++) {
      const e = scratch[i];
      const a = blueItems[i];
      hitEnemy(e, per, w.splash > 1);
      if (w.splash > 1) {
        for (let k = 1; k <= 2; k++) {
          const e2 = scratch[i + k];
          if (e2) hitEnemy(e2, per * 0.55, false);
        }
      }
      fireBullet(
        a.x + M.x, a.y + M.y, a.z + M.z,
        e.x + rnd(-0.14, 0.14), 0.92, e.z + 0.12,
        w.col[0], w.col[1], w.col[2],
        w.splash ? 0.22 : 0.15
      );
      if (i < 5) mflash(a.x + M.x, a.y + M.y, a.z + M.z, w.flash);
    }

    if (w.splash) { if (Math.random() < 0.35) audio.boom(); }
    else if (Math.random() < 0.5) audio.shot();
  }

  function throwGrenade(e) {
    let g = null;
    for (let i = 0; i < grenades.length; i++) if (!grenades[i].active) { g = grenades[i]; break; }
    if (!g) return;
    g.active = true;
    g.t = 0;
    g.dur = 0.95;
    g.sx = e.x; g.sy = 1.15; g.sz = e.z;
    g.tx = S.playerX + rnd(-1.5, 1.5);
    g.ty = 0.35;
    g.tz = S.playerZ + rnd(0.5, 2.6);
    g.arc = 2.4;
    g.dmg = Math.max(TYPE.elite.dps * 2.4, S.count * CFG.PLAYER_HP * 0.018);
    g.mesh.visible = true;
    g.mesh.position.set(g.sx, g.sy, g.sz);
  }

  function updateGrenades(dt) {
    for (let i = 0; i < grenades.length; i++) {
      const g = grenades[i];
      if (!g.active) continue;
      g.t += dt;
      const k = g.t / g.dur;
      if (k >= 1) {
        g.active = false;
        g.mesh.visible = false;
        mflash(g.tx, g.ty + 0.35, g.tz, 1.6);
        spawnSparks(g.tx, 0.45, g.tz, 9, 1, 0.55, 0.15);
        S.shake = Math.max(S.shake, 0.13);
        audio.boom();
        damagePlayer(g.dmg);
        continue;
      }
      const x = g.sx + (g.tx - g.sx) * k;
      const z = g.sz + (g.tz - g.sz) * k;
      const y = g.sy + (g.ty - g.sy) * k + Math.sin(Math.PI * k) * g.arc;
      g.mesh.position.set(x, y, z);
      g.mesh.rotation.x += dt * 10;
      g.mesh.rotation.z += dt * 7;
    }
  }

  function enemyActions(dt, dist) {
    if (dist < 9) {
      let edmg = 0;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.alive && e.type === 'grunt') edmg += TYPE.grunt.dps;
      }
      if (edmg > 0) damagePlayer(edmg * dt);
    }

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive || e.type !== 'elite') continue;
      if (e.atkT === undefined) e.atkT = rnd(0.6, 2.0);
      e.atkT -= dt;
      if (e.atkT <= 0) {
        e.atkT = 2.2;
        if (dist < 26) throwGrenade(e);
      }
    }
  }

  function tickCombat(dt) {
    const w = WEAPON[S.weapon];
    if (aliveCount() === 0) return;

    const dist = nearestDist();
    if (dist <= w.range) {
      S.volleyAcc += dt;
      let guard = 6;
      while (S.volleyAcc >= VOLLEY && guard-- > 0) {
        S.volleyAcc -= VOLLEY;
        playerVolley(w);
      }
    } else {
      S.volleyAcc = 0;
    }

    enemyActions(dt, dist);
  }

  /* ================= 首领：胸口核心激光 ================= */
  let bossPhase = 'idle';
  let bossT = 0;
  let bossCd = 1.6;

  function updateBoss(dt) {
    let boss = null;
    for (let i = 0; i < enemies.length; i++) {
      if (enemies[i].alive && enemies[i].type === 'boss') { boss = enemies[i]; break; }
    }
    if (!boss) {
      ring.visible = false;
      bossCore.visible = false;
      bossGlow.visible = false;
      hideBeam();
      bossPhase = 'idle';
      bossT = 0;
      return;
    }

    const sc = TYPE.boss.scale;
    bossCore.position.set(boss.x, Units.CORE.y * sc, boss.z + Units.CORE.z * sc);
    bossGlow.position.copy(bossCore.position);
    bossCore.visible = true;
    bossGlow.visible = true;

    if (elapsed >= S.stompAt) {
      S.stompAt = elapsed + 1.7;
      S.shake = Math.max(S.shake, 0.22);
      audio.stomp();
      ring.visible = true;
      ring.position.set(boss.x, 0.02, boss.z);
      ringT = 0;
    }

    bossT += dt;
    if (bossPhase === 'idle') {
      const pulse = 0.92 + Math.sin(elapsed * 4) * 0.10;
      bossCore.scale.set(0.42 * pulse, 0.42 * pulse, 1);
      bossGlow.scale.set(0.62 * pulse, 0.62 * pulse, 1);
      bossGlow.material.opacity = 0.36 + Math.sin(elapsed * 4) * 0.08;
      if (bossT >= bossCd) { bossPhase = 'charge'; bossT = 0; audio.roar(); }
    } else if (bossPhase === 'charge') {
      const k = Math.min(1, bossT / 0.9);
      const s = 0.92 + k * 1.30;
      bossCore.scale.set(0.42 * s, 0.42 * s, 1);
      bossGlow.scale.set(0.62 * (1 + k * 1.10), 0.62 * (1 + k * 1.10), 1);
      bossGlow.material.opacity = 0.40 + k * 0.35;
      if (bossT >= 0.9) {
        bossPhase = 'fire';
        bossT = 0;
        damagePlayer(Math.max(TYPE.boss.dps * 4.4, S.count * CFG.PLAYER_HP * 0.09));
        S.shake = Math.max(S.shake, 0.45);
        audio.boom();
        screenFlash(0.5, '#ffb060');
        mflash(S.playerX, 1.0, S.playerZ + 1.6, 2.6);
        spawnSparks(S.playerX, 0.9, S.playerZ + 1.6, 14, 1, 0.6, 0.2);
      }
    } else if (bossPhase === 'fire') {
      const DUR = 1.4;
      const k = bossT / DUR;
      const fade = k < 0.10 ? k / 0.10 : Math.max(0, 1 - (k - 0.10) / 0.90);
      const jitter = Math.sin(bossT * 46) * 0.07;

      _bFrom.set(0, 1.55, boss.z + 0.9);
      _bTo.set(S.playerX + jitter, 0.95, S.playerZ + 1.6);

      for (let i = 0; i < BEAM_N; i++) {
        const t = i / (BEAM_N - 1);
        const sp = beamNodes[i];
        sp.visible = true;
        sp.position.lerpVectors(_bFrom, _bTo, t);

        const mid = Math.sin(t * Math.PI);
        const flick = 0.88 + Math.random() * 0.12;
        const s = (0.55 + 1.55 * t) * flick;
        sp.scale.set(s, s, 1);
        sp.material.opacity = fade * (0.55 + 0.45 * mid) * flick;
      }

      beamHit.visible = true;
      beamHit.position.copy(_bTo);
      const hb = (2.4 + Math.random() * 0.8) * (0.45 + fade * 0.75);
      beamHit.scale.set(hb, hb, 1);
      beamHit.material.opacity = fade * 0.95;

      if (Math.random() < 0.5) spawnSparks(_bTo.x, 0.6, _bTo.z, 1, 1, 0.62, 0.22);

      if (bossT >= DUR) {
        bossPhase = 'idle';
        bossT = 0;
        bossCd = 3.6;
        hideBeam();
        bossCore.scale.set(0.42, 0.42, 1);
        bossGlow.scale.set(0.62, 0.62, 1);
      }
    }
  }

  function updateRing(dt) {
    if (!ring.visible) return;
    ringT += dt;
    const k = ringT / 0.7;
    if (k >= 1) { ring.visible = false; return; }
    const sc = 1 + k * 7;
    ring.scale.set(sc, sc, sc);
    ring.material.opacity = 0.55 * (1 - k);
  }

  /* ================= 关卡流程 ================= */
  function gameOver() {
    S.phase = 'over';
    audio.lose();
    showOverlay('全军覆没', '第 ' + S.level + ' 关倒在了兵线上', '重试本关', function () {
      elOverlay.classList.add('hide');
      beginLevel(S.level, false);
    });
  }

  function levelClear() {
    S.phase = 'over';
    audio.win();
    beginLevel(S.level + 1, true);
  }

  function beginLevel(level, isNext) {
    S.level = level;
    S.startCount = CFG.BASE_START + (level - 1) * CFG.LEVEL_BONUS;
    S.phase = 'loadout';
    S.playerX = 0;
    S.targetX = 0;
    S.vx = 0;
    S.playerZ = 0;
    S.count = S.startCount;
    S.hpAcc = 0;
    S.wave = null;
    S.volleyAcc = 0;
    S.shake = 0;
    S.resumeAt = 0;
    S.shieldLeft = 0;
    S.shieldFlash = 0;
    S.weapon = 'normal';
    S.stompAt = 0;
    units = [];
    enemies = [];
    lastShown = -1;
    lastFoes = -1;
    wepShown = '';
    shlShown = -1;

    while (popups.length) {
      const p = popups.pop();
      fxGroup.remove(p.sp);
      p.sp.material.map.dispose();
      p.sp.material.dispose();
    }
    while (bullets.length) bullets.pop();
    while (sparksArr.length) sparksArr.pop();
    for (let i = 0; i < grenades.length; i++) {
      grenades[i].active = false;
      grenades[i].mesh.visible = false;
    }

    clearGates();
    S.levelData = buildLevel(level);
    syncCrowd();
    elapsed = 0;
    updateHud();
    renderLoadout(isNext);
  }

  /* ================= 每帧 ================= */
  const keys = Object.create(null);
  let elapsed = 0;

  function updatePlayer(dt) {
    let k = 0;
    if (keys.ArrowLeft || keys.KeyA) k -= 1;
    if (keys.ArrowRight || keys.KeyD) k += 1;
    if (k) S.targetX = clamp(S.targetX + k * 8 * dt, -CFG.LANE, CFG.LANE);

    const prev = S.playerX;
    S.playerX += (S.targetX - S.playerX) * Math.min(1, dt * 11);
    S.vx = (S.playerX - prev) / Math.max(dt, 1e-4);
  }

  function updateCrowd(dt) {
    const n = units.length;
    const cols = formationCols(n);
    const amp = S.phase === 'run' ? 0.62 : 0.16;

    for (let i = 0; i < n; i++) {
      const u = units[i];
      const r = Math.floor(i / cols);
      const c = i % cols;
      const rowN = Math.min(cols, n - r * cols);
      const it = blueItems[i];

      const bob = Math.abs(Math.sin(elapsed * 12 + u.ph)) * 0.075;
      it.x = S.playerX + (c - (rowN - 1) / 2) * CFG.GAP_X + u.jx;
      it.z = S.playerZ + r * CFG.GAP_Z + u.jz;
      it.y = 0.02 + bob;
      it.ry = 0;
      it.rz = clamp(-S.vx * 0.045, -0.22, 0.22);
      it.rx = -0.10;
      it.swing = Math.sin(elapsed * 13 + u.ph) * amp;

      const age = elapsed - u.spawn;
      it.s = age >= 0.22 ? 1 : Math.min(1, age / 0.22);
    }
    playerRig.draw(blueItems, n);
  }

  function updateEnemies(dt) {
    const dist = nearestDist();
    const counts = { grunt: 0, elite: 0, boss: 0 };
    const amp = S.phase === 'battle' ? 0.5 : 0.3;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const t = foeItems[e.type];
      const scale = TYPE[e.type].scale;

      if (!e.alive) {
        if (e.dieT > 0) {
          e.dieT -= dt;
          const s = Math.max(0, e.dieT / 0.32);
          if (counts[e.type] < LIMIT[e.type]) {
            const it = t[counts[e.type]++];
            it.x = e.x;
            it.y = 0.02 + (1 - s) * 0.12;
            it.z = e.z;
            it.rx = (1 - s) * 1.35;
            it.ry = Math.PI;
            it.rz = 0;
            it.s = s * scale;
            it.swing = 0;
          }
        }
        continue;
      }

      if (S.phase === 'battle' && dist > CFG.STANDOFF) {
        e.z += TYPE[e.type].speed * dt;
      }

      if (counts[e.type] < LIMIT[e.type]) {
        const it = t[counts[e.type]++];
        const run = S.phase === 'battle' && dist > CFG.STANDOFF;
        it.x = e.x;
        it.z = e.z;
        it.y = 0.02 + Math.abs(Math.sin(elapsed * 12 + e.ph)) * 0.07;
        it.rx = -0.10;
        it.ry = Math.PI;
        it.rz = 0;
        it.s = scale;
        it.swing = Math.sin(elapsed * (e.type === 'boss' ? 5 : 13) + e.ph) * (run ? amp : 0.1);
      }
    }

    gruntRig.draw(foeItems.grunt, counts.grunt);
    eliteRig.draw(foeItems.elite, counts.elite);
    bossRig.draw(foeItems.boss, counts.boss);
  }

  function updateGates(dt) {
    const list = S.levelData.gates;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];

      if (!g.done) {
        if (S.playerZ <= g.z) {
          g.done = true;
          const leftSide = S.playerX < 0;
          const spec = leftSide ? g.left : g.right;
          const px = leftSide ? -1.82 : 1.82;
          applyOp(spec);
          spawnPopup(px, g.z + 1.4, gateText(spec), gateColor(spec));
          audio.gateGood();
          updateHud();
          g.anim = 0.001;
        }
      } else if (g.anim > 0) {
        g.anim += dt * 2.6;
        const k = Math.min(1, g.anim);
        g.group.children[0].scale.y = 1 - k;
        g.group.children[1].scale.y = 1 - k;
        if (k >= 1) { g.group.visible = false; g.anim = 0; }
      }
    }
  }

  function updateWaves(dt) {
    if (S.phase === 'run') {
      const list = S.levelData.waves;
      for (let i = 0; i < list.length; i++) {
        const w = list[i];
        if (w.started || w.done) continue;
        if (S.playerZ <= w.z + CFG.WAVE_TRIGGER) {
          w.started = true;
          spawnWave(w);
          break;
        }
      }
    } else if (S.phase === 'battle') {
      const foes = aliveCount();
      const dist = nearestDist();
      if (foes > 0 && dist > CFG.STANDOFF) S.playerZ -= CFG.BATTLE_SPEED * dt;

      if (foes === 0) {
        if (!S.resumeAt) S.resumeAt = elapsed + 0.5;
        if (elapsed >= S.resumeAt) {
          S.resumeAt = 0;
          S.wave.done = true;
          S.wave = null;
          S.phase = 'run';
          S.hpAcc = 0;

          let allDone = true;
          for (let i = 0; i < S.levelData.waves.length; i++) {
            if (!S.levelData.waves[i].done) allDone = false;
          }
          if (allDone) levelClear();
        }
      }
    }
  }

  function updatePopups(dt) {
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.t += dt;
      p.sp.position.y = 2.2 + p.t * 1.5;
      p.sp.material.opacity = Math.max(0, 1 - p.t / 1.05);
      const s = 2.6 * (1 + p.t * 0.22);
      p.sp.scale.set(s, s * 0.4, 1);
      if (p.t > 1.05) {
        fxGroup.remove(p.sp);
        p.sp.material.map.dispose();
        p.sp.material.dispose();
        popups.splice(i, 1);
      }
    }
  }

  function updateShieldVisual(dt) {
    if (S.shieldLeft > 0.5 && S.count > 0) {
      S.shieldFlash = Math.max(0, S.shieldFlash - dt);
      const n = units.length;
      const rows = Math.ceil(n / formationCols(n));
      const depth = (rows - 1) * CFG.GAP_Z;

      dome.visible = true;
      dome.scale.set(2.35, 1.75, depth * 0.5 + 1.9);
      dome.position.set(S.playerX, 1.75 * 0.92, S.playerZ + depth * 0.5);

      const base = 0.10 + Math.sin(elapsed * 3.2) * 0.03;
      dome.material.opacity = base + S.shieldFlash * 0.45;
    } else {
      dome.visible = false;
    }
  }

  const camPos = new THREE.Vector3(0, 3.6, 7.8);
  const camLook = new THREE.Vector3();

  function updateCamera(dt) {
    const rows = Math.ceil(Math.max(1, units.length) / formationCols(units.length));
    const depth = Math.max(0, (rows - 1) * CFG.GAP_Z);
    const back = 6.9 + depth * 0.86;
    const height = 3.42 + depth * 0.12;
    const tx = S.playerX * 0.42;

    camPos.set(tx, height, S.playerZ + back);
    camera.position.lerp(camPos, Math.min(1, dt * 4.5));

    if (S.shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * S.shake;
      camera.position.y += (Math.random() - 0.5) * S.shake;
      camera.position.z += (Math.random() - 0.5) * S.shake * 0.5;
      S.shake *= Math.pow(0.02, dt);
    }

    camLook.set(tx * 0.55, 1.05 + depth * 0.05, S.playerZ - 8.5);
    camera.lookAt(camLook);
    sky.position.copy(camera.position);

    sun.position.set(S.playerX - 8, 15, S.playerZ + 8);
    sun.target.position.set(S.playerX, 0, S.playerZ - 6);
  }

  /* ================= 输入 ================= */
  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    audio.unlock();
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });

  let dragging = false;
  let lastPX = 0;
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastPX = e.clientX;
    audio.unlock();
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    const dx = e.clientX - lastPX;
    lastPX = e.clientX;
    S.targetX = clamp(S.targetX + dx * 0.024, -CFG.LANE, CFG.LANE);
  });
  function endDrag(e) {
    dragging = false;
    if (canvas.releasePointerCapture && e.pointerId !== undefined) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', endDrag);

  /* ================= 主循环 ================= */
  let last = performance.now();

  function step(dt) {
    elapsed += dt;

    if (S.phase === 'loadout' || S.phase === 'over') {
      updateCrowd(dt);
      updateEnemies(dt);
      updateCamera(dt);
      updateHud();
      return;
    }

    updatePlayer(dt);
    if (S.phase === 'run') {
      S.playerZ -= CFG.RUN_SPEED * dt;
      updateGates(dt);
    }
    updateWaves(dt);
    updateCrowd(dt);
    updateEnemies(dt);
    updateBoss(dt);
    if (S.phase === 'battle') tickCombat(dt);

    updatePopups(dt);
    updateRing(dt);
    updateShieldVisual(dt);
    updateFlashes(dt);
    updateBullets(dt);
    updateSparks(dt);
    updateGrenades(dt);
    updateCamera(dt);
    updateHud();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) dt = 0.016;
    step(dt);
    renderer.render(scene, camera);
  }

  beginLevel(1, false);

  /* 调试：#t=秒 #lv=关 #x=位移 #pick=0盾/1远/2炮/3不换 #freeze=1 */
  const hp = Object.create(null);
  location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
    const p = kv.split('=');
    if (p[0]) hp[p[0]] = p[1] === undefined ? '1' : p[1];
  });

  if (hp.lv) beginLevel(Math.max(1, parseInt(hp.lv, 10) || 1), false);

  const simT = parseFloat(hp.t || '0') || 0;
  const freeze = hp.freeze === '1';

  if (hp.pick !== undefined) {
    const picks = ['shield', 'ranged', 'rpg', 'none'];
    startRun(picks[clamp(parseInt(hp.pick, 10) || 0, 0, 3)]);
  }
  if (hp.x !== undefined) S.targetX = clamp(parseFloat(hp.x) || 0, -CFG.LANE, CFG.LANE);

  if (simT > 0) {
    const steps = Math.round(simT * 60);
    for (let i = 0; i < steps; i++) step(1 / 60);
  }

  renderer.render(scene, camera);
  if (freeze) {
    (function redraw() {
      requestAnimationFrame(redraw);
      renderer.render(scene, camera);
    })();
  } else {
    requestAnimationFrame(frame);
  }
})();
