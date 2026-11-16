// player.js — first-person movement: acceleration, sprint, crouch, jump,
// pointer-lock look, health. Collision is AABB vs the world (world.js).
import * as THREE from 'three';
import { collide } from './world.js';

export const PLAYER = {
  radius: 0.45, eyeStand: 1.62, eyeCrouch: 1.05, height: 1.7,
  walkSpeed: 5.2, sprintSpeed: 7.6, crouchSpeed: 2.6, accel: 42, airAccel: 12,
  jumpVel: 6.4, gravity: 16,
};

export function createPlayer(scene, x, z) {
  const cam = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 220);
  cam.rotation.order = 'YXZ';
  scene.add(cam);
  // Visible gun: a simple low-poly rifle built from boxes, parented to camera.
  const gun = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.45, metalness: 0.7 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xc96f2e, roughness: 0.6, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), dark);
  barrel.position.set(0, 0.02, -0.42);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), orange);
  grip.position.set(0, -0.13, 0.12);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.08), orange);
  sight.position.set(0, 0.1, -0.1);
  gun.add(body, barrel, grip, sight);
  gun.position.set(0.28, -0.26, -0.5);
  cam.add(gun);
  return {
    pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, crouch: false, onGround: true, hp: 100, maxHp: 100,
    armor: 0, alive: true, cam, gun, eye: new THREE.Vector3(x, PLAYER.eyeStand, z),
    quat: new THREE.Quaternion(), recoil: 0, moveSpeed: 0,
  };
}

// keys: {f,b,l,r,sprint,crouch,jump}. dt fixed. Returns nothing; mutates p.
export function stepPlayer(p, keys, dt, colliders) {
  if (!p.alive) return;
  p.crouch = !!keys.crouch;
  const speed = p.crouch ? PLAYER.crouchSpeed : (keys.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed);
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let ix = 0, iz = 0;
  if (keys.f) { ix += -sin; iz += -cos; }
  if (keys.b) { ix += sin; iz += cos; }
  if (keys.l) { ix += -cos; iz += sin; }
  if (keys.r) { ix += cos; iz += -sin; }
  const il = Math.hypot(ix, iz);
  if (il > 0) { ix /= il; iz /= il; }
  const acc = p.onGround ? PLAYER.accel : PLAYER.airAccel;
  p.vel.x += ix * acc * dt; p.vel.z += iz * acc * dt;
  // Friction: light while driving (so sprint can reach its cap), hard when
  // no input is held (crisp stops). Terminal speed while driving is
  // accel / 1.5, well above the sprint cap, so the speed cap governs.
  const damp = p.onGround ? (il > 0 ? Math.exp(-1.5 * dt) : Math.exp(-10 * dt)) : Math.exp(-0.6 * dt);
  p.vel.x *= damp; p.vel.z *= damp;
  const hs = Math.hypot(p.vel.x, p.vel.z);
  if (hs > speed) { p.vel.x *= speed / hs; p.vel.z *= speed / hs; }
  p.moveSpeed = Math.hypot(p.vel.x, p.vel.z);
  const nx = p.pos.x + p.vel.x * dt, nz = p.pos.z + p.vel.z * dt;
  const fixed = collide(colliders, nx, nz, p.pos.y, PLAYER.radius);
  p.pos.x = fixed[0]; p.pos.z = fixed[1];
  if (keys.jump && p.onGround) { p.vel.y = PLAYER.jumpVel; p.onGround = false; }
  p.vel.y -= PLAYER.gravity * dt;
  p.pos.y += p.vel.y * dt;
  if (p.pos.y <= 0) { p.pos.y = 0; p.vel.y = 0; p.onGround = true; }
  // Recoil decays; camera follows body.
  p.recoil = Math.max(0, p.recoil - dt * 6);
  const eyeH = p.crouch ? PLAYER.eyeCrouch : PLAYER.eyeStand;
  p.eye.set(p.pos.x, p.pos.y + eyeH, p.pos.z);
  p.cam.position.copy(p.eye);
  p.cam.rotation.y = p.yaw;
  p.cam.rotation.x = p.pitch + p.recoil;
  p.cam.quaternion.copy(p.cam.quaternion);
  p.quat.copy(p.cam.quaternion);
  // Gun bob + recoil kick (visual only).
  const bob = p.onGround ? Math.sin(performance.now() * 0.012) * 0.008 * Math.min(1, p.moveSpeed / 5) : 0;
  p.gun.position.y = -0.26 + bob + p.recoil * 0.05;
  p.gun.position.z = -0.5 + p.recoil * 0.12;
}

export function damagePlayer(p, amount) {
  if (!p.alive) return 0;
  let left = amount;
  if (p.armor > 0) { const absorbed = Math.min(p.armor, Math.round(left * 0.5)); p.armor -= absorbed; left -= absorbed; }
  p.hp -= left;
  if (p.hp <= 0) { p.hp = 0; p.alive = false; }
  return left;
}
export function healPlayer(p, amount) {
  p.hp = Math.min(p.maxHp, p.hp + amount);
}
