// weapon.js — 3 guns + 1 frag grenade. Hits are raycast against bot
// hitboxes (head = 2x damage); recoil and spread punish moving fire.
import * as THREE from 'three';

export const WEAPONS = {
  rifle:  { name: 'VK-9 Rifle',  kind: 'rifle',  damage: 34, headMult: 2.0, fireRate: 9,  spread: 0.011, moveSpread: 0.030, mag: 30, reserve: 120, reload: 1.6, auto: true,  price: 0,    range: 90 },
  smg:    { name: 'Hornet SMG',  kind: 'smg',    damage: 19, headMult: 1.8, fireRate: 13, spread: 0.020, moveSpread: 0.038, mag: 32, reserve: 160, reload: 1.3, auto: true,  price: 900,  range: 55 },
  sniper: { name: 'Longshot .50', kind: 'sniper', damage: 95, headMult: 2.5, fireRate: 0.9, spread: 0.001, moveSpread: 0.060, mag: 5,  reserve: 25,  reload: 2.4, auto: false, price: 1500, range: 120 },
};
export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;
export const MEDKIT_PRICE = 200;

// A weapon slot: {key, ammo, reserve, reloading, reloadEnd, lastShot}
export function makeSlot(key) {
  const w = WEAPONS[key];
  return { key, ammo: w.mag, reserve: w.reserve, reloading: false, reloadEnd: 0, lastShot: -9 };
}

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _ray = new THREE.Raycaster();

// Fire one shot from `shooter` (player or bot). `targets` are hittable actors
// with {mesh, headMesh, alive, team, takeDamage}. Returns a hit record or null.
// `wallMeshes` block the shot. Spread is in radians; moving adds more.
export function fireHitscan(shooter, weaponKey, spreadRad, targets, wallMeshes, out) {
  const w = WEAPONS[weaponKey];
  _origin.copy(shooter.eye);
  _dir.set(0, 0, -1).applyQuaternion(shooter.quat);
  // Apply spread with a fixed temp — no allocation in the hot path.
  _dir.x += (Math.random() * 2 - 1) * spreadRad;
  _dir.y += (Math.random() * 2 - 1) * spreadRad;
  _dir.z += (Math.random() * 2 - 1) * spreadRad;
  _dir.normalize();
  _ray.set(_origin, _dir);
  _ray.far = w.range;
  const hits = _ray.intersectObjects(wallMeshes, false);
  const wallDist = hits.length ? hits[0].distance : Infinity;
  let best = null, bestDist = wallDist, head = false;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t.alive || t === shooter.actor) continue;
    const hb = _ray.intersectObject(t.mesh, false);
    if (hb.length && hb[0].distance < bestDist) { best = t; bestDist = hb[0].distance; head = false; }
    const hh = _ray.intersectObject(t.headMesh, false);
    if (hh.length && hh[0].distance < bestDist) { best = t; bestDist = hh[0].distance; head = true; }
  }
  if (!best) return null;
  out.target = best; out.distance = bestDist; out.head = head;
  out.damage = Math.round(w.damage * (head ? w.headMult : 1));
  return out;
}

// Grenade: simple ballistic projectile, explodes on ground or after fuse.
export function makeGrenade(scene, pos, vel) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2e4d2a, roughness: 0.5, metalness: 0.6 }));
  mesh.position.copy(pos); scene.add(mesh);
  return { mesh, vel: vel.clone(), fuse: 1.6, alive: true };
}
export function stepGrenade(g, dt, colliders) {
  if (!g.alive) return false;
  g.vel.y -= 18 * dt;
  g.mesh.position.addScaledVector(g.vel, dt);
  g.fuse -= dt;
  const p = g.mesh.position;
  if (p.y <= 0.16 || g.fuse <= 0) {
    p.y = Math.max(p.y, 0.16);
    g.alive = false;
    return true; // exploded
  }
  // Bounce off tall walls: cheap clamp against arena bounds
  const lim = 28.4;
  if (p.x < -lim || p.x > lim) g.vel.x *= -0.4;
  if (p.z < -lim || p.z > lim) g.vel.z *= -0.4;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
  return false;
}
export function grenadeDamage(g, actors) {
  // Returns [{actor, damage}] — falloff from 90 at centre to 25 at 7 m.
  const out = [];
  const p = g.mesh.position;
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    if (!a.alive) continue;
    const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
    if (d > 7) continue;
    out.push({ actor: a, damage: Math.round(90 - (65 * d) / 7) });
  }
  return out;
}
