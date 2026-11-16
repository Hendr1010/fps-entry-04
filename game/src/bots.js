// bots.js — bot AI: patrol routes, hold positions, line-of-sight checks,
// hearing gunshots, and shooting back with spread. One bot = one actor.
import * as THREE from 'three';
import { PAL, mat } from './palette.js';
import { collide, losBlocked } from './world.js';
import { WEAPONS } from './weapon.js';

const _v = new THREE.Vector3();
const _e = new THREE.Vector3();

function makeBotMesh(team) {
  const g = new THREE.Group();
  const suit = mat(team === 'ally' ? PAL.ally : PAL.enemy, 0.8);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.36), suit);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36),
    new THREE.MeshStandardMaterial({ color: 0xd8c49a, roughness: 0.8 }));
  head.position.y = 1.62;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: team === 'ally' ? PAL.ally : PAL.enemy, emissiveIntensity: 0.8 }));
  visor.position.set(0, 1.64, -0.19);
  head.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.4, metalness: 0.7 }));
  gun.position.set(0.25, 1.05, -0.3);
  g.add(body, head, gun);
  body.userData.isBody = true; head.userData.isHead = true;
  return { group: g, body, head };
}

export function createBot(scene, team, x, z, patrol, name) {
  const { group, body, head } = makeBotMesh(team);
  group.position.set(x, 0, z);
  scene.add(group);
  return {
    name, team, actor: null, // back-ref set by main.js (actor wraps bot+player)
    pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(),
    yaw: 0, hp: 100, alive: true, mesh: body, headMesh: head, group,
    eye: new THREE.Vector3(x, 1.5, z), quat: new THREE.Quaternion(),
    patrol, wp: Math.floor(Math.random() * patrol.length),
    holdT: 0, state: 'patrol', target: null, alertPos: null, alertT: -99,
    lastShot: -9, burstLeft: 0, burstT: 0, aimErr: 0.05, speed: 3.4,
    strafeDir: 1, strafeT: 0,
  };
}

// Called when a gunshot rings out: bots within earshot investigate.
export function hearShot(bots, x, z, now) {
  for (let i = 0; i < bots.length; i++) {
    const b = bots[i];
    if (!b.alive) continue;
    const d = Math.hypot(b.pos.x - x, b.pos.z - z);
    if (d < 30) { b.alertPos = b.alertPos || new THREE.Vector3(); b.alertPos.set(x, 0, z); b.alertT = now; }
  }
}

function canSee(b, t, colliders) {
  const d = Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
  if (d > 42) return false;
  return !losBlocked(colliders, b.pos.x, b.pos.z, t.pos.x, t.pos.z);
}

function moveToward(b, tx, tz, dt, colliders, speed) {
  const dx = tx - b.pos.x, dz = tz - b.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.2) return true;
  const vx = (dx / d) * speed, vz = (dz / d) * speed;
  const fixed = collide(colliders, b.pos.x + vx * dt, b.pos.z + vz * dt, 0, 0.45);
  b.pos.x = fixed[0]; b.pos.z = fixed[1];
  // Forward is (-sin yaw, -cos yaw), so yaw = atan2(-dx, -dz) faces the target.
  b.yaw = Math.atan2(-dx, -dz);
  return d < 1.2;
}

// One fixed-step tick for one bot. `foes` = hittable actors of the other team.
// `onShoot(bot, target)` fires the bot's weapon (main.js resolves the hit).
export function stepBot(b, dt, now, foes, colliders, onShoot, sitePos, planted) {
  if (!b.alive) { b.group.visible = false; return; }
  // Pick nearest visible foe.
  let foe = null, foeD = Infinity;
  for (let i = 0; i < foes.length; i++) {
    const f = foes[i];
    if (!f.alive) continue;
    const d = Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z);
    if (d < foeD && canSee(b, f, colliders)) { foe = f; foeD = d; }
  }
  b.target = foe;
  if (foe) b.state = 'combat';
  else if (planted && b.team === 'enemy') b.state = 'defuse';
  else if (b.alertPos && now - b.alertT < 6) b.state = 'investigate';
  else b.state = 'patrol';

  if (b.state === 'combat') {
    // Face the foe, strafe sideways, keep 8–16 m, shoot in bursts.
    const dx = foe.pos.x - b.pos.x, dz = foe.pos.z - b.pos.z;
    b.yaw = Math.atan2(-dx, -dz);
    b.strafeT -= dt;
    if (b.strafeT <= 0) { b.strafeDir *= -1; b.strafeT = 0.7 + Math.random() * 0.8; }
    const dist = Math.hypot(dx, dz);
    let mx = 0, mz = 0;
    if (dist > 16) { mx = dx / dist; mz = dz / dist; }
    else if (dist < 7) { mx = -dx / dist; mz = -dz / dist; }
    const px = -dz / dist * b.strafeDir, pz = dx / dist * b.strafeDir;
    const fixed = collide(colliders, b.pos.x + (mx + px * 0.7) * 2.6 * dt, b.pos.z + (mz + pz * 0.7) * 2.6 * dt, 0, 0.45);
    b.pos.x = fixed[0]; b.pos.z = fixed[1];
    // Burst fire: 3–5 shots, pause, repeat. Spread grows with range.
    b.burstT -= dt;
    if (b.burstLeft <= 0 && b.burstT <= 0) { b.burstLeft = 3 + Math.floor(Math.random() * 3); b.burstT = 0.9 + Math.random() * 0.7; }
    if (b.burstLeft > 0 && now - b.lastShot > 0.14) {
      b.lastShot = now; b.burstLeft--;
      b.aimErr = 0.035 + foeD * 0.0016;
      onShoot(b, foe, b.aimErr);
    }
  } else if (b.state === 'defuse') {
    // Enemy bot rushes the planted core to defuse it.
    if (moveToward(b, sitePos.x, sitePos.z, dt, colliders, 4.2)) { b.state = 'defusing'; }
  } else if (b.state === 'investigate') {
    moveToward(b, b.alertPos.x, b.alertPos.z, dt, colliders, 3.8);
    if (Math.hypot(b.alertPos.x - b.pos.x, b.alertPos.z - b.pos.z) < 1.5) b.alertT = -99;
  } else {
    // Patrol: walk the route, pause 1.5 s at each waypoint (holding position).
    if (b.holdT > 0) { b.holdT -= dt; }
    else {
      const wp = b.patrol[b.wp];
      if (moveToward(b, wp.x, wp.z, dt, colliders, b.speed)) {
        b.wp = (b.wp + 1) % b.patrol.length; b.holdT = 1.5;
      }
    }
  }
  // Sync mesh + eye + facing quaternion.
  b.group.position.set(b.pos.x, 0, b.pos.z);
  b.group.rotation.y = b.yaw;
  b.eye.set(b.pos.x, 1.5, b.pos.z);
  _e.set(0, 1, 0);
  b.quat.setFromAxisAngle(_e, b.yaw);
  _v.set(0, 0, -1).applyQuaternion(b.quat);
}
export { WEAPONS };
