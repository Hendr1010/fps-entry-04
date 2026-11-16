// main.js — ZONEFALL boot + fixed-step simulation + rendering.
// Simulation runs at a fixed 60 Hz and never allocates in hot loops;
// rendering only draws the state the simulation produced.
import * as THREE from 'three';
import { PAL } from './palette.js';
import { buildWorld, zoneStateAt, ZONE_STAGES } from './world.js';
import { createPlayer, stepPlayer, damagePlayer, healPlayer } from './player.js';
import { WEAPONS, GRENADE_PRICE, makeSlot, fireHitscan, makeGrenade, stepGrenade, grenadeDamage } from './weapon.js';
import { createBot, stepBot, hearShot } from './bots.js';
import { createMatch, startBuyPhase, startRound, endRound, stepRound, timeoutWinner, SHOP, ROUND_TIME, WIN_ROUNDS } from './rounds.js';
import { createHud, updateHud, drawMinimap, addKill, showBanner, showScreen } from './hud.js';
import { createSound } from './sound.js';

const FIXED_DT = 1 / 60;
const $ = (id) => document.getElementById(id);

// ---------------- state: one object, everything the game needs ------------
const S = {
  scene: null, renderer: null, clock: 0, simTime: 0,
  player: null, playerActor: null, bots: [], actors: [],
  world: null, wallMeshes: [], match: createMatch(),
  slots: [], current: 0, grenades: 0, owned: {},
  keys: {}, firing: false, mouseDX: 0, mouseDY: 0,
  zone: { radius: 40, cx: 0, cz: 0, stage: 0, nextIn: 22 },
  nearSite: false, nearLoot: null, outsideZone: false, zoneTick: 0, zoneWarnT: -9,
  loot: [], tracers: [], tracerIdx: 0, grenadesLive: [],
  explosion: null, explT: 0, shake: 0,
  planting: false, defusing: false, botDefusing: false,
  roundEndT: -1, bannerT: -9, respawnT: 0,
};
const sound = createSound();
const hud = createHud();
const _hit = { target: null, distance: 0, head: false, damage: 0 };
const _fwd = new THREE.Vector3();
const _tmp = new THREE.Vector3();

S.weaponLabel = (key) => WEAPONS[key].name;

// ---------------- scene setup ---------------------------------------------
function initScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.sky);
  scene.fog = new THREE.Fog(PAL.fog, 40, 130);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  $('game-canvas').appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.3));
  const sun = new THREE.DirectionalLight(PAL.sun, 2.2);
  sun.position.set(30, 45, -20); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  scene.add(sun);
  S.scene = scene; S.renderer = renderer;
  S.world = buildWorld(scene);
  // Wall meshes for bullet blocking: every box in the world group.
  S.world.group.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.type === 'BoxGeometry') S.wallMeshes.push(o); });
  // Tracer pool (10 reused lines) + explosion flash mesh.
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 10; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(g, tracerMat);
    line.visible = false; line.frustumCulled = false; scene.add(line);
    S.tracers.push({ line, ttl: 0 });
  }
  S.explosion = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0 }));
  S.explosion.visible = false; scene.add(S.explosion);
  // Player hitboxes (invisible) so bots can shoot the player.
  const hbMat = new THREE.MeshBasicMaterial({ visible: false });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.36), hbMat);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), hbMat);
  scene.add(body, head);
  S.playerHit = { body, head };
  window.addEventListener('resize', () => {
    S.player.cam.aspect = window.innerWidth / window.innerHeight;
    S.player.cam.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function spawnLoot() {
  for (const l of S.loot) S.scene.remove(l.mesh);
  S.loot = [];
  const colors = { rifle: 0xffb020, smg: 0x37c8ff, sniper: 0xff4d3d, grenade: 0x7dff5e, medkit: 0xffffff };
  for (const sp of S.world.lootSpawns) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.55),
      new THREE.MeshStandardMaterial({ color: colors[sp.kind], emissive: colors[sp.kind], emissiveIntensity: 0.9, roughness: 0.4 }));
    mesh.position.set(sp.x, 0.6, sp.z);
    S.scene.add(mesh);
    S.loot.push({ x: sp.x, z: sp.z, kind: sp.kind, mesh, taken: false, bob: Math.random() * 6 });
  }
}

function spawnActors() {
  for (const b of S.bots) S.scene.remove(b.group);
  S.bots = []; S.actors = [];
  const p = S.player;
  p.pos.set(S.world.spawns.ally[0].x, 0, S.world.spawns.ally[0].z);
  p.yaw = -Math.PI * 0.75; p.pitch = 0; p.hp = p.maxHp; p.alive = true;
  S.playerActor = { pos: p.pos, alive: true, team: 'ally', name: 'YOU', kind: 'player', ref: p,
    mesh: S.playerHit.body, headMesh: S.playerHit.head };
  S.actors.push(S.playerActor);
  const mk = (team, i) => {
    const sp = S.world.spawns[team][i % S.world.spawns[team].length];
    const patrol = S.world.patrols[(team === 'enemy' ? i : i + 2) % S.world.patrols.length];
    const b = createBot(S.scene, team, sp.x, sp.z, patrol, team === 'ally' ? 'Ally-' + (i + 1) : 'Raider-' + (i + 1));
    b.actor = { pos: b.pos, alive: true, team, name: b.name, kind: 'bot', ref: b, mesh: b.mesh, headMesh: b.headMesh };
    S.bots.push(b); S.actors.push(b.actor);
  };
  for (let i = 0; i < 2; i++) mk('ally', i);
  for (let i = 0; i < 4; i++) mk('enemy', i);
  spawnLoot();
}

function resetLoadout() {
  S.slots = [makeSlot('rifle')]; S.current = 0; S.grenades = 0; S.owned = { rifle: true };
  S.player.armor = 0;
}

// ---------------- combat ---------------------------------------------------
function showTracer(from, to) {
  const t = S.tracers[S.tracerIdx]; S.tracerIdx = (S.tracerIdx + 1) % S.tracers.length;
  const pos = t.line.geometry.attributes.position.array;
  pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
  pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.visible = true; t.ttl = 0.07;
}
function tracerEnd(shooter, dist) {
  _fwd.set(0, 0, -1).applyQuaternion(shooter.quat);
  return _tmp.copy(shooter.eye).addScaledVector(_fwd, dist).clone();
}

function damageActor(actor, dmg, attackerName, head) {
  if (!actor.alive) return;
  if (actor.kind === 'player') {
    const dealt = damagePlayer(S.player, dmg);
    if (dealt > 0) { sound.hurt(); S.shake = Math.min(0.5, S.shake + 0.2); }
    if (!S.player.alive) {
      actor.alive = false;
      addKill(hud, attackerName + ' ⌖ YOU', false);
      showBanner(hud, 'YOU ARE DOWN', 'Your squad fights on — next round you respawn.', '#ff4d3d');
    }
    return;
  }
  const b = actor.ref;
  b.hp -= dmg;
  if (b.hp <= 0) {
    b.hp = 0; b.alive = false; actor.alive = false; b.group.visible = false;
    S.match.kills += attackerName === 'YOU' ? 1 : 0;
    S.match.roundKills += attackerName === 'YOU' ? 1 : 0;
    addKill(hud, attackerName + ' ⌖ ' + b.name + (head ? '  [HEADSHOT]' : ''), attackerName === 'YOU' || b.team === 'enemy');
    if (attackerName === 'YOU') sound.kill();
  }
}

function playerShoot() {
  const slot = S.slots[S.current];
  const w = WEAPONS[slot.key];
  const now = S.simTime;
  if (slot.reloading || now - slot.lastShot < 1 / w.fireRate) return;
  if (slot.ammo <= 0) { sound.dry(); slot.lastShot = now; return; }
  slot.ammo--; slot.lastShot = now;
  const p = S.player;
  const moving = p.moveSpeed / 5.2;
  const spread = w.spread + moving * w.moveSpread + p.recoil * 0.02 + (p.crouch ? -0.004 : 0);
  const foes = S.actors.filter((a) => a.team === 'enemy');
  const hit = fireHitscan({ eye: p.eye, quat: p.quat, actor: S.playerActor }, slot.key, Math.max(0.001, spread), foes, S.wallMeshes, _hit);
  p.recoil = Math.min(0.09, p.recoil + (w.kind === 'sniper' ? 0.085 : w.kind === 'smg' ? 0.012 : 0.022));
  sound.shoot(w.kind);
  hearShot(S.bots, p.pos.x, p.pos.z, now);
  const end = hit ? tracerEnd({ eye: p.eye, quat: p.quat }, hit.distance)
    : tracerEnd({ eye: p.eye, quat: p.quat }, w.range);
  _tmp.copy(p.eye).addScaledVector(_fwd.set(0, 0, -1).applyQuaternion(p.quat), 0.5);
  showTracer(_tmp, end);
  if (hit) {
    hud.hitT = performance.now() / 1000;
    if (hit.head) sound.headshot(); else sound.hit();
    damageActor(hit.target, hit.damage, 'YOU', hit.head);
  }
}

function botShoot(bot, foe, spread) {
  const w = WEAPONS.rifle;
  const foes = foe.kind === 'player' ? [S.playerActor] : S.actors.filter((a) => a.team !== bot.team);
  const hit = fireHitscan({ eye: bot.eye, quat: bot.quat, actor: bot.actor }, 'rifle', spread, foes, S.wallMeshes, _hit);
  sound.enemyShoot();
  const end = hit ? tracerEnd({ eye: bot.eye, quat: bot.quat }, hit.distance)
    : tracerEnd({ eye: bot.eye, quat: bot.quat }, 40);
  _tmp.copy(bot.eye); showTracer(_tmp, end);
  if (hit && hit.target === S.playerActor) {
    // Damage direction indicator: angle of the shooter relative to view.
    const ang = Math.atan2(bot.pos.x - S.player.pos.x, bot.pos.z - S.player.pos.z) - S.player.yaw;
    hud.dmgAngle = ang; hud.dmgT = performance.now() / 1000;
  }
  if (hit) damageActor(hit.target, hit.damage, bot.name, hit.head);
}

function throwGrenade() {
  if (S.grenades <= 0 || S.match.phase !== 'live') return;
  S.grenades--;
  const p = S.player;
  _fwd.set(0, 0, -1).applyQuaternion(p.quat);
  const pos = _tmp.copy(p.eye).addScaledVector(_fwd, 0.6).clone();
  const vel = _fwd.clone().multiplyScalar(16); vel.y += 4;
  S.grenadesLive.push(makeGrenade(S.scene, pos, vel));
  sound.beep();
}

function explode(g) {
  sound.explode(); S.shake = 0.7;
  S.explosion.position.copy(g.mesh.position);
  S.explosion.visible = true; S.explT = 0.35;
  const hits = grenadeDamage(g, S.actors);
  for (const h of hits) damageActor(h.actor, h.damage, 'YOU', false);
  S.scene.remove(g.mesh);
}

// ---------------- round flow ----------------------------------------------
function startMatch() {
  S.match = createMatch();
  resetLoadout();
  spawnActors();
  startBuyPhase(S.match);
  buildShop();
  showScreen(hud, 'buy');
  showBanner(hud, 'ZONEFALL', 'First to 3 rounds wins the match.', '#ffb020');
}

function beginRound() {
  spawnActors();
  S.player.hp = S.player.maxHp;
  startRound(S.match);
  showScreen(hud, null);
  document.body.classList.add('playing');
  showBanner(hud, 'ROUND ' + S.match.round, 'Plant the Zone Core or eliminate the Raiders.', '#fff');
  sound.beep();
}

function finishRound(winner, reason) {
  if (!endRound(S.match, winner, reason)) return;
  const won = winner === 'ally';
  if (won) sound.roundWin(); else sound.roundLose();
  const label = won ? 'ROUND WON' : 'ROUND LOST';
  showBanner(hud, label, reason + '   •   $' + S.match.money, won ? '#37d67a' : '#ff4d3d');
  S.roundEndT = 3.5;
}

function nextAfterRound() {
  if (S.match.scoreA >= WIN_ROUNDS || S.match.scoreB >= WIN_ROUNDS) {
    S.match.phase = 'matchEnd';
    const won = S.match.scoreA >= WIN_ROUNDS;
    hud.el.endTitle.textContent = won ? '🏆 MATCH WON' : 'MATCH LOST';
    hud.el.endTitle.style.color = won ? '#37d67a' : '#ff4d3d';
    hud.el.endSub.textContent = `Final score ${S.match.scoreA} — ${S.match.scoreB}  •  Kills: ${S.match.kills}  •  Money: $${S.match.money}`;
    showScreen(hud, 'end');
    document.exitPointerLock && document.exitPointerLock();
    return;
  }
  S.match.round++;
  startBuyPhase(S.match);
  buildShop();
  showScreen(hud, 'buy');
  document.exitPointerLock && document.exitPointerLock();
}

function buildShop() {
  const list = hud.el.buyList;
  list.innerHTML = '';
  hud.el.buyMoney.textContent = '$' + S.match.money;
  for (const item of SHOP) {
    const owned = item.id === 'smg' || item.id === 'sniper' || item.id === 'rifle' ? !!S.owned[item.id] : false;
    const btn = document.createElement('button');
    btn.className = 'shop-item' + (owned ? ' owned' : '');
    btn.innerHTML = `<span>${item.label}</span><b>${owned ? 'OWNED' : '$' + item.price}</b>`;
    btn.onclick = () => { buyItem(item); };
    list.appendChild(btn);
  }
}

function buyItem(item) {
  const m = S.match;
  if (m.money < item.price) { showBanner(hud, 'NOT ENOUGH MONEY', '', '#ff4d3d'); return; }
  if ((item.id === 'smg' || item.id === 'sniper' || item.id === 'rifle') && S.owned[item.id]) return;
  m.money -= item.price;
  if (item.id === 'grenade') S.grenades++;
  else if (item.id === 'armor') S.player.armor = 100;
  else if (item.id === 'medkit') healPlayer(S.player, 100);
  else if (item.id === 'ammo') { for (const s of S.slots) s.reserve = WEAPONS[s.key].reserve; }
  else { S.owned[item.id] = true; S.slots.push(makeSlot(item.id)); S.current = S.slots.length - 1; }
  sound.pickup();
  buildShop();
}

// ---------------- fixed-step simulation ------------------------------------
function step(dt) {
  const m = S.match;
  S.simTime += dt;
  if (m.phase === 'title' || m.phase === 'matchEnd') return;
  if (m.phase === 'roundEnd') {
    S.roundEndT -= dt;
    if (S.roundEndT <= 0) nextAfterRound();
    return;
  }
  // Zone state from the round clock.
  const t = m.phase === 'live' ? ROUND_TIME - m.roundT : 0;
  S.zone = zoneStateAt(t);
  if (m.phase === 'buy') {
    const ev = stepRound(m, dt, { ally: 3, enemy: 4 }, false, false, false);
    if (ev === 'buyTimeout') beginRound();
    return;
  }
  // --- live round ---
  const p = S.player;
  // Input -> movement (only while alive)
  if (p.alive) {
    const k = S.keys;
    stepPlayer(p, { f: k['KeyW'], b: k['KeyS'], l: k['KeyA'], r: k['KeyD'], sprint: k['ShiftLeft'] || k['ShiftRight'], crouch: k['KeyC'] || k['ControlLeft'], jump: k['Space'] }, dt, S.world.colliders);
    p.yaw -= S.mouseDX * 0.0022; p.pitch -= S.mouseDY * 0.0022;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
    S.mouseDX = 0; S.mouseDY = 0;
    if (S.firing) playerShoot();
    // Reload
    const slot = S.slots[S.current];
    if (slot.reloading && S.simTime >= slot.reloadEnd) {
      const need = WEAPONS[slot.key].mag - slot.ammo;
      const take = Math.min(need, slot.reserve);
      slot.ammo += take; slot.reserve -= take; slot.reloading = false;
    }
  }
  // Player hitbox meshes follow the player.
  S.playerHit.body.position.set(p.pos.x, p.pos.y + 0.95, p.pos.z);
  S.playerHit.head.position.set(p.pos.x, p.pos.y + 1.62, p.pos.z);
  S.playerHit.body.rotation.y = p.yaw; S.playerHit.head.rotation.y = p.yaw;
  // Zone damage
  const zd = Math.hypot(p.pos.x - S.zone.cx, p.pos.z - S.zone.cz);
  S.outsideZone = p.alive && zd > S.zone.radius;
  if (S.outsideZone) {
    S.zoneTick += dt * 6;
    if (S.zoneTick >= 1) { S.zoneTick -= 1; damagePlayer(p, 1); if (!p.alive) { S.playerActor.alive = false; } }
    if (S.simTime - S.zoneWarnT > 2) { S.zoneWarnT = S.simTime; sound.zoneWarn(); }
  }
  // Near site / loot
  S.nearSite = Math.hypot(p.pos.x, p.pos.z) < 4.6;
  S.nearLoot = null;
  for (const l of S.loot) {
    if (l.taken) continue;
    if (Math.hypot(p.pos.x - l.x, p.pos.z - l.z) < 1.7 && p.alive) {
      S.nearLoot = l.kind.toUpperCase() + ' PICKUP';
      l.taken = true; S.scene.remove(l.mesh); sound.pickup();
      if (l.kind === 'medkit') healPlayer(p, 50);
      else if (l.kind === 'grenade') S.grenades++;
      else if (S.owned[l.kind]) { const s = S.slots.find((x) => x.key === l.kind); if (s) s.reserve = Math.min(s.reserve + 60, WEAPONS[l.kind].reserve); }
      else { S.owned[l.kind] = true; S.slots.push(makeSlot(l.kind)); }
      addKill(hud, 'Picked up ' + l.kind.toUpperCase(), true);
    }
  }
  // Plant / defuse input
  S.planting = !!S.keys['KeyE'] && p.alive && S.nearSite && !m.planted;
  S.defusing = !!S.keys['KeyE'] && p.alive && S.nearSite && m.planted;
  // Bots
  const allyFoes = S.actors.filter((a) => a.team === 'enemy' && a.alive);
  const enemyFoes = S.actors.filter((a) => a.team === 'ally' && a.alive);
  S.botDefusing = false;
  for (const b of S.bots) {
    if (!b.alive) continue;
    const foes = b.team === 'ally' ? allyFoes : enemyFoes;
    stepBot(b, dt, S.simTime, foes, S.world.colliders, botShoot, { x: 0, z: 0 }, m.planted);
    if (b.state === 'defusing' && Math.hypot(b.pos.x, b.pos.z) < 4.6) S.botDefusing = true;
  }
  // Grenades in flight
  for (let i = S.grenadesLive.length - 1; i >= 0; i--) {
    const g = S.grenadesLive[i];
    if (stepGrenade(g, dt, S.world.colliders)) { explode(g); S.grenadesLive.splice(i, 1); }
  }
  // Round state machine
  const aliveA = S.bots.filter((b) => b.team === 'ally' && b.alive).length + (p.alive ? 1 : 0);
  const aliveE = S.bots.filter((b) => b.team === 'enemy' && b.alive).length;
  const ev = stepRound(m, dt, { ally: aliveA, enemy: aliveE }, S.planting, S.defusing || S.botDefusing, S.nearSite);
  if (ev === 'planted') { showBanner(hud, 'ZONE CORE PLANTED', 'Detonation in 12s — defend it!', '#ffb020'); sound.plant(); }
  else if (ev === 'defused') finishRound('enemy', 'Raiders defused the Zone Core.');
  else if (ev === 'detonated') finishRound('ally', 'Zone Core detonated — site secured.');
  else if (ev === 'eliminated') finishRound('ally', m.planted ? 'All Raiders eliminated after the plant.' : 'All Raiders eliminated.');
  else if (ev === 'wiped') finishRound('enemy', 'Your squad was wiped out.');
  else if (ev === 'timeout') finishRound(timeoutWinner({ ally: aliveA, enemy: aliveE }), 'Time expired — more fighters alive win.');
  // Zone wall follows the safe zone.
  S.world.zoneWall.position.x = S.zone.cx; S.world.zoneWall.position.z = S.zone.cz;
  S.world.zoneWall.scale.set(S.zone.radius, 1, S.zone.radius);
  S.world.zoneRing.position.x = S.zone.cx; S.world.zoneRing.position.z = S.zone.cz;
  S.world.zoneRing.scale.set(S.zone.radius, S.zone.radius, 1);
}

// ---------------- render ---------------------------------------------------
function render() {
  // Tracers fade, explosion expands, loot bobs — visual only.
  for (const t of S.tracers) {
    if (t.ttl > 0) { t.ttl -= 1 / 60; if (t.ttl <= 0) t.line.visible = false; }
  }
  if (S.explT > 0) {
    S.explT -= 1 / 60;
    const f = 1 - S.explT / 0.35;
    S.explosion.scale.setScalar(1 + f * 7);
    S.explosion.material.opacity = Math.max(0, 0.85 * (1 - f));
    if (S.explT <= 0) S.explosion.visible = false;
  }
  const now = performance.now() / 1000;
  for (const l of S.loot) {
    if (!l.taken) { l.mesh.position.y = 0.6 + Math.sin(now * 2 + l.bob) * 0.12; l.mesh.rotation.y += 0.02; }
  }
  if (S.shake > 0) {
    S.shake = Math.max(0, S.shake - 0.03);
    S.player.cam.position.x += (Math.random() - 0.5) * S.shake * 0.08;
    S.player.cam.position.y += (Math.random() - 0.5) * S.shake * 0.08;
  }
  S.renderer.render(S.scene, S.player.cam);
  updateHud(hud, S);
  drawMinimap(hud, S);
}

// ---------------- input ----------------------------------------------------
function bindInput() {
  const canvas = S.renderer.domElement;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    S.keys[e.code] = true;
    if (e.repeat) return;
    if (e.code === 'KeyR') reload();
    if (e.code === 'KeyG') throwGrenade();
    if (e.code === 'KeyB' && S.match.phase === 'buy') beginRound();
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
      const i = Number(e.code.slice(5)) - 1;
      if (S.slots[i]) { S.current = i; sound.beep(); }
    }
    if (e.code === 'Enter' && S.match.phase === 'title') startMatch();
  });
  window.addEventListener('keyup', (e) => { S.keys[e.code] = false; });
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && S.match.phase === 'live' && document.pointerLockElement) S.firing = true;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) S.firing = false; });
  window.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement) { S.mouseDX += e.movementX; S.mouseDY += e.movementY; }
  });
  canvas.addEventListener('click', () => {
    if (S.match.phase === 'live' && !document.pointerLockElement) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement) S.firing = false;
  });
}

function reload() {
  const slot = S.slots[S.current];
  if (!slot || slot.reloading || slot.ammo === WEAPONS[slot.key].mag || slot.reserve <= 0) return;
  slot.reloading = true; slot.reloadEnd = S.simTime + WEAPONS[slot.key].reload;
  sound.reload();
}

// ---------------- boot -----------------------------------------------------
function boot() {
  initScene();
  S.player = createPlayer(S.scene, -25, -25);
  spawnActors();
  resetLoadout();
  bindInput();
  $('deploy-btn').onclick = () => {
    sound.unlock();
    startMatch();
    S.renderer.domElement.requestPointerLock && S.renderer.domElement.requestPointerLock();
  };
  $('start-round-btn').onclick = () => { sound.unlock(); beginRound(); };
  $('restart-btn').onclick = () => { sound.unlock(); startMatch(); };
  $('buy-close').onclick = () => beginRound();
  showScreen(hud, 'title');
  // Test / screenshot hook: lets automation drive the game without a mouse.
  window.__zonefall = {
    state: S, start: () => { sound.unlock(); startMatch(); },
    beginRound, forceWin: () => finishRound('ally', 'Test round win.'),
    forceLose: () => finishRound('enemy', 'Test round loss.'),
    setZone: (r) => { S.zone.radius = r; },
    // Test-only: fire the current weapon for ~300 ms without pointer lock.
    shoot: () => { S.firing = true; setTimeout(() => { S.firing = false; }, 300); },
    teleport: (x, z) => { S.player.pos.set(x, 0, z); },
    // Deterministic logic hooks: run the fixed-step sim directly, no render.
    stepN: (n) => { for (let i = 0; i < n; i++) step(FIXED_DT); },
    setFiring: (v) => { S.firing = v; },
    setKey: (code, v) => { S.keys[code] = v; },
    aimAt: (x, z) => { S.player.yaw = Math.atan2(-(x - S.player.pos.x), -(z - S.player.pos.z)); S.player.pitch = 0; },
  };
  const params = new URLSearchParams(location.search);
  if (params.get('auto') === '1') { startMatch(); beginRound(); }
  if (params.get('auto') === '2') { startMatch(); }
  // Fixed-step loop.
  let last = performance.now(), acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let n = 0;
    while (acc >= FIXED_DT && n < 8) { step(FIXED_DT); acc -= FIXED_DT; n++; }
    render();
  }
  requestAnimationFrame(frame);
}
boot();
