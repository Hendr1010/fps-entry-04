// hud.js — HUD updates, 2D minimap, kill feed, banners, damage indicator.
// Reads the single state object; writes only DOM. No game logic here.
const $ = (id) => document.getElementById(id);

export function createHud() {
  return {
    el: {
      hpBar: $('hp-bar'), hpText: $('hp-text'), armorText: $('armor-text'),
      ammo: $('ammo'), weaponName: $('weapon-name'), money: $('money'),
      timer: $('timer'), score: $('score'), roundLabel: $('round-label'),
      zoneTimer: $('zone-timer'), alive: $('alive'),
      feed: $('killfeed'), banner: $('banner'), bannerSub: $('banner-sub'),
      minimap: $('minimap'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      dmg: $('dmg-indicator'), plantBar: $('plant-bar'), plantFill: $('plant-fill'),
      title: $('title-screen'), buy: $('buy-screen'), buyList: $('buy-list'),
      buyMoney: $('buy-money'), end: $('end-screen'), endTitle: $('end-title'),
      endSub: $('end-sub'), prompt: $('prompt'), zoneWarn: $('zone-warn'),
      grenades: $('grenades'),
    },
    feedItems: [], hitT: -9, dmgAngle: 0, dmgT: -9,
  };
}

export function updateHud(h, S) {
  const e = h.el, p = S.player, m = S.match;
  const hpPct = Math.max(0, p.hp);
  e.hpBar.style.width = hpPct + '%';
  e.hpBar.style.background = hpPct > 50 ? '#37d67a' : hpPct > 25 ? '#ffb020' : '#ff3b30';
  e.hpText.textContent = Math.ceil(p.hp) + ' HP';
  e.armorText.textContent = p.armor > 0 ? '🛡 ' + p.armor : '';
  const slot = S.slots[S.current];
  e.ammo.textContent = slot ? slot.ammo + ' / ' + slot.reserve : '—';
  e.weaponName.textContent = slot ? S.weaponLabel(slot.key) : '';
  e.grenades.textContent = '◉ ×' + S.grenades;
  e.money.textContent = '$' + m.money;
  e.timer.textContent = m.phase === 'buy' ? 'BUY ' + Math.ceil(m.buyT) + 's'
    : Math.max(0, Math.ceil(m.roundT)) + 's';
  e.score.textContent = m.scoreA + ' — ' + m.scoreB;
  e.roundLabel.textContent = 'ROUND ' + m.round;
  e.zoneTimer.textContent = 'ZONE ' + Math.ceil(S.zone.nextIn) + 's · R' + Math.max(1, S.zone.radius | 0) + 'm';
  const aliveA = S.bots.filter(b => b.team === 'ally' && b.alive).length + (p.alive ? 1 : 0);
  const aliveE = S.bots.filter(b => b.team === 'enemy' && b.alive).length;
  e.alive.textContent = '👥 ' + aliveA + ' vs ' + aliveE;
  // Plant / defuse progress
  if (m.planted) {
    e.plantBar.style.display = 'block';
    e.plantFill.style.width = (m.plantT / 12 * 100) + '%';
    e.plantFill.style.background = '#ff3b30';
  } else if (m.plantProgress > 0 || m.defuseProgress > 0) {
    e.plantBar.style.display = 'block';
    const v = m.plantProgress > 0 ? m.plantProgress : m.defuseProgress;
    e.plantFill.style.width = (v * 100) + '%';
    e.plantFill.style.background = '#ffb020';
  } else e.plantBar.style.display = 'none';
  // Context prompt
  let prompt = '';
  if (m.phase === 'live' && p.alive) {
    if (!m.planted && S.nearSite) prompt = '[E] PLANT ZONE CORE (hold)';
    else if (m.planted && S.nearSite) prompt = '[E] DEFUSE CORE (hold)';
    else if (S.nearLoot) prompt = '[F] PICK UP ' + S.nearLoot;
  }
  e.prompt.textContent = prompt;
  e.zoneWarn.style.display = S.outsideZone ? 'block' : 'none';
  // Hitmarker + damage direction fade
  const now = performance.now() / 1000;
  e.hitmarker.style.opacity = now - h.hitT < 0.18 ? '1' : '0';
  e.dmg.style.opacity = now - h.dmgT < 0.9 ? '0.9' : '0';
  e.dmg.style.transform = `translate(-50%,-50%) rotate(${h.dmgAngle}rad)`;
}

export function drawMinimap(h, S) {
  const c = h.el.minimap, ctx = c.getContext('2d');
  const W = c.width, H = c.height, scale = W / 62;
  const toX = (x) => (x + 31) * scale, toZ = (z) => (z + 31) * scale;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(10,26,30,0.85)'; ctx.fillRect(0, 0, W, H);
  // Walls
  ctx.fillStyle = '#5a7d75';
  for (const col of S.world.colliders) {
    ctx.fillRect(toX(col.x0), toZ(col.z0), (col.x1 - col.x0) * scale, (col.z1 - col.z0) * scale);
  }
  // Bomb site
  ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(toX(0), toZ(0), 4.2 * scale, 0, Math.PI * 2); ctx.stroke();
  // Safe zone ring (white) + danger outside tint
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(toX(S.zone.cx), toZ(S.zone.cz), S.zone.radius * scale, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,60,40,0.12)';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.arc(toX(S.zone.cx), toZ(S.zone.cz), S.zone.radius * scale, 0, Math.PI * 2); ctx.clip();
  ctx.clearRect(0, 0, W, H);
  ctx.restore();
  // Loot dots
  ctx.fillStyle = '#7dff5e';
  for (const l of S.loot) if (!l.taken) { ctx.beginPath(); ctx.arc(toX(l.x), toZ(l.z), 3, 0, Math.PI * 2); ctx.fill(); }
  // Bots
  for (const b of S.bots) {
    if (!b.alive) continue;
    ctx.fillStyle = b.team === 'ally' ? '#37c8ff' : '#ff4d3d';
    ctx.beginPath(); ctx.arc(toX(b.pos.x), toZ(b.pos.z), 4, 0, Math.PI * 2); ctx.fill();
  }
  // Player arrow
  const px = toX(S.player.pos.x), pz = toZ(S.player.pos.z);
  ctx.save(); ctx.translate(px, pz); ctx.rotate(-S.player.yaw + Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
}

export function addKill(h, text, good) {
  const div = document.createElement('div');
  div.className = 'feed-item' + (good ? ' good' : ' bad');
  div.textContent = text;
  h.el.feed.prepend(div);
  h.feedItems.push(div);
  while (h.feedItems.length > 5) { const old = h.feedItems.shift(); old.remove(); }
  setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 400); }, 4500);
}

export function showBanner(h, title, sub, color) {
  h.el.banner.textContent = title;
  h.el.bannerSub.textContent = sub || '';
  h.el.banner.style.color = color || '#fff';
  h.el.banner.style.opacity = '1';
  h.el.bannerSub.style.opacity = '1';
  setTimeout(() => { h.el.banner.style.opacity = '0'; h.el.bannerSub.style.opacity = '0'; }, 2600);
}

export function showScreen(h, which) {
  h.el.title.style.display = which === 'title' ? 'flex' : 'none';
  h.el.buy.style.display = which === 'buy' ? 'flex' : 'none';
  h.el.end.style.display = which === 'end' ? 'flex' : 'none';
}
