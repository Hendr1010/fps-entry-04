// rounds.js — the round state machine, economy, buy menu data, and the
// Zone Core plant / defuse objective. All match state lives in one object.
export const ROUND_TIME = 100;
export const WIN_ROUNDS = 3;
export const BUY_TIME = 14;

export function createMatch() {
  return {
    phase: 'title', // title | buy | live | roundEnd | matchEnd
    round: 1, scoreA: 0, scoreB: 0, money: 800,
    roundT: ROUND_TIME, buyT: BUY_TIME, phaseT: 0,
    planted: false, plantT: 0, plantProgress: 0, defuseProgress: 0,
    defuser: null, planter: null, winner: null, winReason: '',
    kills: 0, deaths: 0, roundKills: 0,
  };
}

export function startBuyPhase(m) {
  m.phase = 'buy'; m.buyT = BUY_TIME; m.phaseT = 0;
  m.planted = false; m.plantT = 0; m.plantProgress = 0; m.defuseProgress = 0;
  m.defuser = null; m.planter = null; m.roundKills = 0;
}

export function startRound(m) {
  m.phase = 'live'; m.roundT = ROUND_TIME; m.phaseT = 0;
  m.planted = false; m.plantT = 0; m.plantProgress = 0; m.defuseProgress = 0;
}

export function endRound(m, winner, reason) {
  if (m.phase !== 'live') return false;
  m.phase = 'roundEnd'; m.phaseT = 0; m.winner = winner; m.winReason = reason;
  if (winner === 'ally') {
    m.scoreA++; m.money += 1000 + m.roundKills * 300;
  } else {
    m.scoreB++; m.money += 500 + m.roundKills * 300;
  }
  // NOTE: phase stays 'roundEnd'; nextAfterRound() checks the match score
  // and switches to 'matchEnd' when a team reaches WIN_ROUNDS.
  return true;
}

// Tick the round timer / plant timer. Returns an event string or ''.
// `alive` = {ally: n, enemy: n}; `planting`/`defusing` are booleans from input.
export function stepRound(m, dt, alive, planting, defusing, nearSite) {
  if (m.phase === 'buy') {
    m.buyT -= dt;
    if (m.buyT <= 0) return 'buyTimeout';
    return '';
  }
  if (m.phase !== 'live') return '';
  m.phaseT += dt;
  m.roundT -= dt;

  // Planting: hold E near the site for 3 s.
  if (!m.planted && planting && nearSite) {
    m.plantProgress += dt / 3;
    if (m.plantProgress >= 1) { m.planted = true; m.plantT = 12; m.plantProgress = 0; return 'planted'; }
  } else if (!m.planted) m.plantProgress = Math.max(0, m.plantProgress - dt / 1.5);

  if (m.planted) {
    m.plantT -= dt;
    if (defusing) {
      m.defuseProgress += dt / 4;
      if (m.defuseProgress >= 1) { m.planted = false; m.defuseProgress = 0; return 'defused'; }
    } else m.defuseProgress = Math.max(0, m.defuseProgress - dt / 2);
    if (m.plantT <= 0) return 'detonated';
  }

  if (alive.enemy === 0) return 'eliminated';
  if (alive.ally === 0) return 'wiped';
  if (m.roundT <= 0) return 'timeout';
  return '';
}

export function timeoutWinner(alive) {
  // Timer expired with no plant: the team with more players alive wins.
  if (alive.ally > alive.enemy) return 'ally';
  if (alive.enemy > alive.ally) return 'enemy';
  return 'enemy'; // tie goes to the defenders (enemy)
}

export const SHOP = [
  { id: 'smg', label: 'Hornet SMG — fast, close range', price: 900 },
  { id: 'sniper', label: 'Longshot .50 — one-shot headshot', price: 1500 },
  { id: 'rifle', label: 'VK-9 Rifle — balanced all-rounder', price: 1200 },
  { id: 'grenade', label: 'Frag Grenade ×1', price: 300 },
  { id: 'armor', label: 'Plated Armor — absorbs 50% (100 pts)', price: 650 },
  { id: 'medkit', label: 'Medkit — heal to full', price: 200 },
  { id: 'ammo', label: 'Ammo refill — all weapons', price: 250 },
];
