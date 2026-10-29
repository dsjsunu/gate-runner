/* units.js — 程序化角色几何 + 实例化群体渲染（带腿摆动）
   对外：Units.makeRig(kind, max) / Units.gunGeometry(scale) / Units.MUZZLE */
(function (global) {
  'use strict';

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();
  const _e2 = new THREE.Euler();

  /* ---------- 几何工具 ---------- */
  function mergeParts(parts) {
    let total = 0;
    const list = parts.map(function (p) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      total += g.attributes.position.count;
      return { g: g, c: new THREE.Color(p.color) };
    });

    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);

    let o = 0;
    for (let i = 0; i < list.length; i++) {
      const g = list[i].g;
      const c = list[i].c;
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      for (let k = 0; k < n; k++) {
        const j = (o + k) * 3;
        col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b;
      }
      o += n;
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }

  function p(geo, color, px, py, pz, rx, ry, rz, sc) {
    const g = geo.clone();
    if (sc !== undefined) g.scale(sc, sc, sc);
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(_q));
    g.translate(px || 0, py || 0, pz || 0);
    return { geo: g, color: color };
  }

  function place(parts, m) {
    for (let i = 0; i < parts.length; i++) parts[i].geo.applyMatrix4(m);
    return parts;
  }

  /* 用两个关节点生成一节肢体 */
  function limb(a, b, r, color) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const geo = new THREE.CapsuleGeometry(r, Math.max(0.02, len - r * 2), 4, 8);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx, dy, dz).normalize()
    );
    geo.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    geo.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    return { geo: geo, color: color };
  }

  function matrix(px, py, pz, rx, ry, rz, sc) {
    _e2.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e2);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(px || 0, py || 0, pz || 0),
      _q.clone(),
      new THREE.Vector3(sc === undefined ? 1 : sc, sc === undefined ? 1 : sc, sc === undefined ? 1 : sc)
    );
  }

  /* ---------- 枪（局部原点，枪口朝 -Z） ---------- */
  function gunParts() {
    const METAL = 0x2b323b;
    const DARK = 0x1c222a;
    const ACC = 0x5d6b7a;
    const body = new THREE.BoxGeometry(0.10, 0.12, 0.46);
    const barrel = new THREE.CylinderGeometry(0.034, 0.034, 0.46, 8);
    const guard = new THREE.BoxGeometry(0.09, 0.10, 0.22);
    const mag = new THREE.BoxGeometry(0.07, 0.19, 0.10);
    const stock = new THREE.BoxGeometry(0.08, 0.13, 0.20);
    const scope = new THREE.BoxGeometry(0.05, 0.05, 0.18);
    return [
      p(body, METAL, 0, 0, 0),
      p(barrel, DARK, 0, 0.012, -0.44, Math.PI / 2, 0, 0),
      p(guard, METAL, 0, -0.04, -0.22),
      p(mag, DARK, 0, -0.13, 0.02, 0.22, 0, 0),
      p(stock, DARK, 0, -0.01, 0.30),
      p(scope, ACC, 0, 0.10, -0.04)
    ];
  }

  /* ---------- 榴弹发射器（精英用） ---------- */
  function launcherParts() {
    const METAL = 0x3c434c;
    const DARK = 0x232930;
    const BRASS = 0x9a7a34;
    const tube = new THREE.CylinderGeometry(0.078, 0.078, 0.44, 10);
    const drum = new THREE.CylinderGeometry(0.105, 0.105, 0.11, 12);
    const grip = new THREE.BoxGeometry(0.06, 0.15, 0.08);
    const stock = new THREE.BoxGeometry(0.07, 0.12, 0.20);
    return [
      p(tube, METAL, 0, 0.01, -0.30, Math.PI / 2, 0, 0),
      p(drum, BRASS, 0, -0.075, -0.06, Math.PI / 2, 0, 0),
      p(grip, DARK, 0, -0.13, 0.03),
      p(stock, DARK, 0, 0.0, 0.20)
    ];
  }

  /* ---------- 士兵身体（原点在脚底） ---------- */
  function buildBody(colors, opts) {
    opts = opts || {};
    const SKIN = 0xeebd97;

    const head = new THREE.SphereGeometry(0.215, 16, 12);
    const helm = new THREE.SphereGeometry(0.232, 16, 12);
    const torso = new THREE.CapsuleGeometry(0.225, 0.30, 5, 14);
    const packG = new THREE.BoxGeometry(0.27, 0.30, 0.13);
    const handGeo = new THREE.SphereGeometry(0.076, 8, 6);
    const pad = new THREE.SphereGeometry(0.14, 10, 8);

    // 肩 → 肘 → 手：上臂自然下垂，前臂向前收，手落在枪的握把上
    const SH_R = [0.205, 0.955, 0.00], EL_R = [0.318, 0.752, -0.050], HA_R = [0.418, 0.850, -0.235];
    const SH_L = [-0.205, 0.955, 0.00], EL_L = [-0.248, 0.765, -0.100], HA_L = [0.100, 0.885, -0.400];

    const parts = [
      p(torso, colors.main, 0, 0.72, 0),
      p(packG, colors.pack, 0, 0.76, 0.21, 0.06, 0, 0),
      p(head, SKIN, 0, 1.12, 0),
      p(helm, colors.dark, 0, 1.155, -0.01, 0, 0, 0, 1.03, 0.88, 1.05),
      limb(SH_R, EL_R, 0.076, colors.main),
      limb(EL_R, HA_R, 0.066, colors.main),
      limb(SH_L, EL_L, 0.076, colors.main),
      limb(EL_L, HA_L, 0.066, colors.main),
      p(handGeo, 0x2b3140, HA_R[0], HA_R[1], HA_R[2]),
      p(handGeo, 0x2b3140, HA_L[0], HA_L[1], HA_L[2])
    ];

    if (opts.pads) {
      parts.push(p(pad, colors.dark, -0.27, 1.00, 0.02, 0, 0, 0, 1.25, 0.8, 1.05));
      parts.push(p(pad, colors.dark, 0.27, 1.00, 0.02, 0, 0, 0, 1.25, 0.8, 1.05));
    }
    if (opts.crest) {
      const crest = new THREE.BoxGeometry(0.05, 0.16, 0.30);
      parts.push(p(crest, colors.trim || 0xffcf5a, 0, 1.30, 0.02));
    }

    // 枪整体摆到身体右前方，枪管明显探出轮廓
    const gp = opts.launcher ? launcherParts() : gunParts();
    place(gp, matrix(0.42, 0.955, -0.24, -0.05, -0.32, 0.04, opts.gunScale || 1.15));
    for (let i = 0; i < gp.length; i++) parts.push(gp[i]);

    return mergeParts(parts);
  }

  /* ---------- 腿（原点在髋关节，向下延伸） ---------- */
  function buildLeg(colors) {
    const leg = new THREE.CapsuleGeometry(0.086, 0.26, 4, 8);
    const boot = new THREE.BoxGeometry(0.15, 0.11, 0.22);
    return mergeParts([
      p(leg, colors.dark, 0, -0.21, 0),
      p(boot, 0x2a3140, 0, -0.40, -0.03)
    ]);
  }

  /* ---------- 大怪（Boss） ---------- */
  function buildBrute() {
    const MAIN = 0x8f2b1e;
    const DARK = 0x54170f;
    const BONE = 0xe6d8bd;
    const IRON = 0x4a4f57;

    const torso = new THREE.CapsuleGeometry(0.46, 0.50, 6, 14);
    const sh = new THREE.SphereGeometry(0.34, 12, 10);
    const armG = new THREE.CapsuleGeometry(0.155, 0.52, 5, 10);
    const head = new THREE.SphereGeometry(0.235, 12, 10);
    const horn = new THREE.ConeGeometry(0.075, 0.36, 7);
    const plate = new THREE.BoxGeometry(0.72, 0.44, 0.16);

    return mergeParts([
      p(torso, MAIN, 0, 1.18, 0),
      p(plate, IRON, 0, 1.30, -0.36),
      p(sh, DARK, -0.56, 1.62, 0),
      p(sh, DARK, 0.56, 1.62, 0),
      p(armG, DARK, -0.64, 1.16, 0.02, 0, 0, 0.16),
      p(armG, DARK, 0.64, 1.16, 0.02, 0, 0, -0.16),
      p(head, MAIN, 0, 1.92, -0.02),
      p(horn, BONE, -0.19, 2.14, 0.02, 0, 0, 0.5),
      p(horn, BONE, 0.19, 2.14, 0.02, 0, 0, -0.5),
      // 胸口核心：外圈铁环 + 凹槽（发光体在 game.js 里单独叠上去）
      p(new THREE.CylinderGeometry(0.215, 0.215, 0.10, 14), 0x1b1b20, 0, 1.30, -0.42, Math.PI / 2, 0, 0),
      // 眼睛
      p(new THREE.SphereGeometry(0.045, 8, 6), 0xffd24a, -0.10, 1.95, -0.20),
      p(new THREE.SphereGeometry(0.045, 8, 6), 0xffd24a, 0.10, 1.95, -0.20)
    ]);
  }

  function buildBruteLeg() {
    const leg = new THREE.CapsuleGeometry(0.16, 0.32, 4, 10);
    const boot = new THREE.BoxGeometry(0.26, 0.14, 0.34);
    return mergeParts([
      p(leg, 0x54170f, 0, -0.28, 0),
      p(boot, 0x2a2f36, 0, -0.52, -0.04)
    ]);
  }

  /* ---------- 材质 ---------- */
  const MAT = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.62, metalness: 0.03
  });

  const PALETTE = {
    blue: { main: 0x2f6ee0, dark: 0x1f4a9e, pack: 0x1b3a78, trim: 0xffd166 },
    red: { main: 0xd4442f, dark: 0x94241a, pack: 0x6b1a10, trim: 0xffd166 },
    elite: { main: 0x8e2033, dark: 0x4d0f1c, pack: 0x330a12, trim: 0xffc247 },
    boss: { main: 0x8f2b1e, dark: 0x54170f, pack: 0x3a0f0a, trim: 0xffd24a }
  };

  /* ---------- Rig ---------- */
  function Rig(kind, max) {
    max = max || 300;
    let bodyGeo, legGeo, hip = 0.50, legX = 0.105;

    if (kind === 'boss') {
      bodyGeo = buildBrute();
      legGeo = buildBruteLeg();
      hip = 0.62; legX = 0.24;
    } else {
      const c = PALETTE[kind] || PALETTE.red;
      bodyGeo = buildBody(c, {
        pads: kind === 'elite',
        crest: kind === 'elite',
        launcher: kind === 'elite',
        gunScale: kind === 'elite' ? 1.2 : 1
      });
      legGeo = buildLeg(c);
    }

    this.body = new THREE.InstancedMesh(bodyGeo, MAT, max);
    this.legs = new THREE.InstancedMesh(legGeo, MAT, max * 2);
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.legs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.body.castShadow = true;
    this.legs.castShadow = true;
    this.body.frustumCulled = false;
    this.legs.frustumCulled = false;
    this.body.count = 0;
    this.legs.count = 0;
    this.max = max;
    this.hip = hip;
    this.legX = legX;
  }

  Rig.prototype.addTo = function (scene) {
    scene.add(this.body);
    scene.add(this.legs);
    return this;
  };

  Rig.prototype.draw = function (items, n) {
    n = Math.min(n, this.max);
    const body = this.body;
    const legs = this.legs;
    const hip = this.hip;
    const legX = this.legX;

    for (let i = 0; i < n; i++) {
      const it = items[i];
      const s = it.s === undefined ? 1 : it.s;
      const swing = it.swing || 0;

      _e.set(it.rx || 0, it.ry || 0, it.rz || 0, 'YXZ');
      _q.setFromEuler(_e);
      _v.set(it.x, it.y, it.z);
      _s.set(s, s, s);
      _m.compose(_v, _q, _s);
      body.setMatrixAt(i, _m);

      // 左腿
      _v.set(it.x - legX * s, it.y + hip * s, it.z);
      _e.set(swing, it.ry || 0, 0, 'YXZ');
      _q.setFromEuler(_e);
      _s.set(s, s, s);
      _m.compose(_v, _q, _s);
      legs.setMatrixAt(i * 2, _m);

      // 右腿
      _v.set(it.x + legX * s, it.y + hip * s, it.z);
      _e.set(-swing, it.ry || 0, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_v, _q, _s);
      legs.setMatrixAt(i * 2 + 1, _m);
    }

    body.count = n;
    legs.count = n * 2;
    body.instanceMatrix.needsUpdate = true;
    legs.instanceMatrix.needsUpdate = true;
  };

  /* ---------- 枪线 ---------- */
  function Tracers(max) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 6);
    const col = new Float32Array(max * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false
    });
    const mesh = new THREE.LineSegments(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;

    this.mesh = mesh;
    this.geo = geo;
    this.pos = pos;
    this.col = col;
    this.max = max;
    this.n = 0;
    this.data = new Float32Array(max * 10);
  }

  Tracers.prototype.fire = function (ax, ay, az, bx, by, bz, r, g, b, life) {
    if (this.n >= this.max) return;
    const d = this.data;
    const o = this.n * 10;
    d[o] = ax; d[o + 1] = ay; d[o + 2] = az;
    d[o + 3] = bx; d[o + 4] = by; d[o + 5] = bz;
    d[o + 6] = life === undefined ? 0.075 : life;
    d[o + 7] = r === undefined ? 1 : r;
    d[o + 8] = g === undefined ? 0.85 : g;
    d[o + 9] = b === undefined ? 0.45 : b;
    this.n++;
  };

  Tracers.prototype.update = function (dt) {
    const d = this.data;
    const pos = this.pos;
    const col = this.col;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * 10;
      d[o + 6] -= dt;
      if (d[o + 6] <= 0) continue;
      if (w !== i) {
        for (let j = 0; j < 10; j++) d[w * 10 + j] = d[o + j];
      }
      const k = w * 6;
      const src = w * 10;
      pos[k] = d[src]; pos[k + 1] = d[src + 1]; pos[k + 2] = d[src + 2];
      pos[k + 3] = d[src + 3]; pos[k + 4] = d[src + 4]; pos[k + 5] = d[src + 5];
      col[k] = d[src + 7]; col[k + 1] = d[src + 8]; col[k + 2] = d[src + 9];
      col[k + 3] = d[src + 7]; col[k + 4] = d[src + 8]; col[k + 5] = d[src + 9];
      w++;
    }
    this.n = w;
    this.geo.setDrawRange(0, w * 2);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  };

  global.Units = {
    Rig: Rig,
    gunGeometry: function () { return mergeParts(gunParts()); },
    glowTexture: function () {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.28, 'rgba(255,255,255,0.85)');
      grd.addColorStop(0.62, 'rgba(255,255,255,0.22)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      return t;
    },
    MUZZLE: { x: 0.63, y: 0.97, z: -0.88 },
    CORE: { x: 0, y: 1.30, z: 0.68 }
  };
})(window);
