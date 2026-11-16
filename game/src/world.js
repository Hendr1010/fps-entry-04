// world.js — "Zonefall Compound": an original walled arena.
// Builds the three.js geometry, the AABB colliders, loot spawns, the bomb
// site, and the shrinking safe zone. Pure map data + zone math; no AI here.
import * as THREE from 'three';
import { PAL, mat, emissiveMat } from './palette.js';

export const ARENA = 58; // playable half-extent (arena is 58 x 58)

// One collider: axis-aligned box in XZ plus a top height.
export function makeCollider(x0, z0, x1, z1, top) {
  return { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), top };
}

// Segment (x0,z0)->(x1,z1) blocked by any wall collider? Used for line of sight.
const _t = { v: 0 };
export function losBlocked(colliders, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.top < 1.2) continue; // low crates do not block sight
    let tmin = 0, tmax = 1, ok = true;
    if (Math.abs(dx) < 1e-9) { if (ax < c.x0 || ax > c.x1) continue; }
    else {
      let t1 = (c.x0 - ax) / dx, t2 = (c.x1 - ax) / dx;
      if (t1 > t2) { _t.v = t1; t1 = t2; t2 = _t.v; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) ok = false;
    }
    if (!ok) continue;
    if (Math.abs(dz) < 1e-9) { if (az < c.z0 || az > c.z1) continue; }
    else {
      let t1 = (c.z0 - az) / dz, t2 = (c.z1 - az) / dz;
      if (t1 > t2) { _t.v = t1; t1 = t2; t2 = _t.v; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    return true;
  }
  return false;
}

// Resolve a circle (radius r) at (x,z) with feet height y against colliders.
// Returns corrected [x,z]. Low boxes (top <= y+0.55) can be stepped/jumped onto.
export function collide(colliders, x, z, y, r) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (y + 0.55 >= c.top) continue;
    const nx = Math.max(c.x0, Math.min(x, c.x1));
    const nz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - nx, dz = z - nz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2), push = (r - d) / d;
      x += dx * push; z += dz * push;
    } else {
      // centre inside the box: push out along the smallest penetration axis
      const pl = x - c.x0 + r, pr = c.x1 - x + r, pt = z - c.z0 + r, pb = c.z1 - z + r;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) x = c.x0 - r; else if (m === pr) x = c.x1 + r;
      else if (m === pt) z = c.z0 - r; else z = c.z1 + r;
    }
  }
  const lim = ARENA / 2 - 0.6;
  if (x < -lim) x = -lim; if (x > lim) x = lim;
  if (z < -lim) z = -lim; if (z > lim) z = lim;
  return [x, z];
}

export function buildWorld(scene) {
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);
  const box = (w, h, d, x, y, z, material, top) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    if (top !== null) colliders.push(makeCollider(x - w / 2, z - d / 2, x + w / 2, z + d / 2, top));
    return m;
  };

  // Ground + grid glow lines
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA + 8, ARENA + 8), mat(PAL.ground, 1));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);
  const grid = new THREE.GridHelper(ARENA, 29, PAL.groundLine, PAL.groundLine);
  grid.position.y = 0.02; group.add(grid);

  // Outer walls
  const H = 4.2, T = 1;
  box(ARENA + 2, H, T, 0, H / 2, -ARENA / 2, mat(PAL.wall), H);
  box(ARENA + 2, H, T, 0, H / 2, ARENA / 2, mat(PAL.wall), H);
  box(T, H, ARENA + 2, -ARENA / 2, H / 2, 0, mat(PAL.wall), H);
  box(T, H, ARENA + 2, ARENA / 2, H / 2, 0, mat(PAL.wall), H);
  // Orange wall caps
  box(ARENA + 2, 0.25, T + 0.2, 0, H + 0.12, -ARENA / 2, emissiveMat(PAL.accent, 0.7), null);
  box(ARENA + 2, 0.25, T + 0.2, 0, H + 0.12, ARENA / 2, emissiveMat(PAL.accent, 0.7), null);

  // Lane walls (three lanes: west, centre, east) — tall, block sight + movement
  const wall = (w, d, x, z) => box(w, 3.2, d, x, 1.6, z, mat(PAL.wall), 3.2);
  wall(10, 1, -14, -10); wall(10, 1, -14, 10);
  wall(10, 1, 14, -10); wall(10, 1, 14, 10);
  wall(1, 12, -8, -18); wall(1, 12, 8, -18);
  wall(1, 12, -8, 18); wall(1, 12, 8, 18);
  wall(6, 1, -20, 0); wall(6, 1, 20, 0);
  // Corner blocks
  wall(4, 4, -22, -22); wall(4, 4, 22, -22); wall(4, 4, -22, 22); wall(4, 4, 22, 22);

  // Crates (low: jumpable, orange) — cover in lanes and plaza
  const crate = (s, x, z, h) => box(s, h, s, x, h / 2, z, mat(PAL.crate), h);
  crate(2.2, -5, -6, 1.15); crate(2.2, 5, -6, 1.15);
  crate(2.2, -5, 6, 1.15); crate(2.2, 5, 6, 1.15);
  crate(1.6, -12, 0, 1.15); crate(1.6, 12, 0, 1.15);
  crate(2.4, 0, -14, 1.15); crate(2.4, 0, 14, 1.15);
  crate(1.8, -18, -4, 1.15); crate(1.8, 18, 4, 1.15);
  // Stacked tall crates (full cover)
  box(2.4, 2.6, 2.4, -16, 1.3, 16, mat(PAL.crateDark), 2.6);
  box(2.4, 2.6, 2.4, 16, 1.3, -16, mat(PAL.crateDark), 2.6);

  // Elevated walkway: deck over the west lane with a ramp block (steppable)
  const deck = box(10, 0.4, 4, -14, 2.4, 0, mat(PAL.walkway), 2.6);
  deck.receiveShadow = true;
  box(2, 2.2, 4, -20, 1.1, 0, mat(PAL.walkway), 2.2); // ramp block you jump from
  // Support pillars (visual only, thin — still colliders so you cannot walk through)
  box(0.5, 2.2, 0.5, -10, 1.1, -1.6, mat(PAL.wallTop), 2.2);
  box(0.5, 2.2, 0.5, -10, 1.1, 1.6, mat(PAL.wallTop), 2.2);

  // Central plaza: bomb site ring (Zone Core site)
  const siteRing = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.2, 40), emissiveMat(PAL.site, 1.4));
  siteRing.rotation.x = -Math.PI / 2; siteRing.position.y = 0.03; group.add(siteRing);
  const sitePad = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.5, 8), mat(PAL.crateDark));
  sitePad.position.set(0, 0.25, 0); sitePad.castShadow = true; group.add(sitePad);
  colliders.push(makeCollider(-1.1, -1.1, 1.1, 1.1, 0.5));
  const siteBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7, 8), emissiveMat(PAL.site, 2));
  siteBeacon.position.set(0, 3.5, 0); group.add(siteBeacon);

  // Zone wall: translucent cylinder that follows the safe zone
  const zoneGeo = new THREE.CylinderGeometry(1, 1, 9, 48, 1, true);
  const zoneMat = new THREE.MeshBasicMaterial({ color: PAL.accent, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  const zoneWall = new THREE.Mesh(zoneGeo, zoneMat);
  zoneWall.position.y = 4.5; group.add(zoneWall);
  const zoneRingGeo = new THREE.RingGeometry(0.97, 1, 48);
  const zoneRing = new THREE.Mesh(zoneRingGeo, new THREE.MeshBasicMaterial({ color: PAL.accent, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  zoneRing.rotation.x = -Math.PI / 2; zoneRing.position.y = 0.05; group.add(zoneRing);

  // Loot spawn points (positions only; meshes are made by main.js loot logic)
  const lootSpawns = [
    { x: -5, z: -6, kind: 'rifle' }, { x: 5, z: 6, kind: 'smg' },
    { x: -12, z: 0, kind: 'sniper' }, { x: 0, z: -14, kind: 'grenade' },
    { x: 0, z: 14, kind: 'medkit' }, { x: -18, z: -4, kind: 'medkit' },
    { x: 18, z: 4, kind: 'grenade' }, { x: 12, z: 0, kind: 'rifle' },
  ];
  // Spawn points for teams
  const spawns = {
    ally: [{ x: -25, z: -25 }, { x: -25, z: -20 }, { x: -20, z: -25 }],
    enemy: [{ x: 25, z: 25 }, { x: 25, z: 20 }, { x: 20, z: 25 }, { x: 26, z: 14 }],
  };
  // Bot patrol waypoints (loops through lanes and plaza)
  const patrols = [
    [{ x: 16, z: 16 }, { x: 10, z: 0 }, { x: 0, z: -4 }, { x: -6, z: -14 }, { x: 16, z: -16 }],
    [{ x: 18, z: -18 }, { x: 12, z: -8 }, { x: 0, z: 4 }, { x: 12, z: 14 }, { x: 18, z: 6 }],
    [{ x: 16, z: 18 }, { x: 0, z: 12 }, { x: -10, z: 4 }, { x: -4, z: 16 }, { x: 10, z: 18 }],
    [{ x: 24, z: 0 }, { x: 14, z: -14 }, { x: 0, z: -8 }, { x: 14, z: 8 }, { x: 24, z: 14 }],
  ];
  return { group, colliders, lootSpawns, spawns, patrols, zoneWall, zoneRing, sitePos: new THREE.Vector3(0, 0, 0) };
}

// --- Shrinking safe zone: 3 stages inside a 100 s round -----------------
// stageEnds: seconds when each shrink finishes. Radius goes 40 -> 26 -> 15 -> 8.
export const ZONE_STAGES = [
  { end: 22, radius: 26 },
  { end: 48, radius: 15 },
  { end: 74, radius: 8 },
];
export function zoneStateAt(t) {
  // Returns {radius, cx, cz, stage, nextIn} — centre drifts toward the plaza.
  let radius = 40, cx = 0, cz = 0, stage = 0, nextIn = ZONE_STAGES[0].end - t;
  for (let i = 0; i < ZONE_STAGES.length; i++) {
    const prevEnd = i === 0 ? 0 : ZONE_STAGES[i - 1].end;
    const prevR = i === 0 ? 40 : ZONE_STAGES[i - 1].radius;
    if (t >= ZONE_STAGES[i].end) { radius = ZONE_STAGES[i].radius; stage = i + 1; continue; }
    const f = Math.max(0, Math.min(1, (t - prevEnd) / (ZONE_STAGES[i].end - prevEnd)));
    radius = prevR + (ZONE_STAGES[i].radius - prevR) * f;
    nextIn = ZONE_STAGES[i].end - t;
    stage = i;
    break;
  }
  // Centre eases from (6,-6) toward (0,0) as the zone shrinks.
  const drift = Math.max(0, Math.min(1, (40 - radius) / 32));
  cx = 6 * (1 - drift); cz = -6 * (1 - drift);
  return { radius, cx, cz, stage, nextIn: Math.max(0, nextIn) };
}
