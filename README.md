# ZONEFALL — Tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Hendr1010/fps-entry-04/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Hendr1010/fps-entry-04/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**ZONEFALL** is an original round-based tactical FPS built with three.js — Counter-Strike-style rounds fused with a shrinking safe zone.

You and two ally bots face four Raider bots in the **Zonefall Compound**, an original walled arena with three lanes, crates, a central plaza and an elevated walkway. Win a round by eliminating the enemy team, or by planting the **Zone Core** at the golden site and defending it until detonation — while the safe zone shrinks in three stages and drains the health of anyone caught outside it.

- **Rounds:** first team to 3 round wins takes the match; 100-second rounds
- **Economy:** earn money per round (win / loss / kills) and spend it in the buy menu — SMG, sniper rifle, armor, grenades, medkits, ammo
- **Weapons:** VK-9 Rifle, Hornet SMG, Longshot .50 sniper, frag grenade — all with ammo, reloads, recoil and movement-punishing spread; headshots deal double damage
- **Bots:** patrol routes, hold positions, react to line of sight and to gunshots, strafe and burst-fire; allies follow and support you
- **Loot:** weapon, grenade and medkit pickups scattered on the map
- **HUD:** health, ammo, round timer, score, money, kill feed, minimap with live zone ring, zone timer, alive count, crosshair, hitmarker, damage-direction indicator

## How to run

```sh
# any static server works, e.g.
python3 -m http.server 8080 --directory game
# then open http://localhost:8080/index.html
```

Click **DEPLOY**, buy (or skip) in the armory, then fight. WASD move, mouse aim, click shoot, R reload, Shift sprint, C crouch, Space jump, E plant/defuse (hold near the site), G grenade, 1/2/3 switch weapon, B start round.

## Layout

- `game/index.html` — HUD + screens, import map for vendored three.js
- `game/src/main.js` — boot + fixed-step (60 Hz) simulation, kept apart from rendering
- `game/src/world.js` — Zonefall Compound map, AABB collision, shrinking zone
- `game/src/player.js` — movement, camera, health
- `game/src/weapon.js` — guns, grenade, raycast hits, headshots
- `game/src/bots.js` — bot AI
- `game/src/rounds.js` — round state machine, economy, plant/defuse, shop
- `game/src/hud.js` — HUD, minimap, kill feed
- `game/src/sound.js` — synthesized WebAudio sounds (no audio files)
- `game/src/palette.js` — the dusk-teal + warm-orange palette
- `main.ts` — builds `/output` (game + screenshots + dossier.json)

MIT licensed. Original map, art, sounds and names — no assets copied from any commercial game.
