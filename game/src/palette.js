// palette.js — ZONEFALL's one palette: dusk teal + warm orange.
// Every material in the game comes from here so the look stays coherent.
import * as THREE from 'three';

export const PAL = {
  sky: 0x0e1a24,        // dusk sky / fog
  fog: 0x12222e,
  ground: 0x354a45,     // teal-grey concrete
  groundLine: 0x243834,
  wall: 0x4d7268,       // teal wall
  wallTop: 0x6b8a80,
  crate: 0xc96f2e,      // warm orange crate
  crateDark: 0x9a5220,
  accent: 0xff8c2e,     // zone / UI orange
  danger: 0xff3b30,
  ally: 0x37c8ff,       // ally blue
  enemy: 0xff4d3d,      // enemy red-orange
  site: 0xffb020,       // bomb site gold
  loot: 0x7dff5e,
  walkway: 0x4a6b74,
  hemiSky: 0x8fb8c9,
  hemiGround: 0x2a2118,
  sun: 0xffd9a0,
};

const cache = new Map();
export function mat(color, rough = 0.9, metal = 0.05) {
  const key = color + '|' + rough + '|' + metal;
  let m = cache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); cache.set(key, m); }
  return m;
}
export function emissiveMat(color, intensity = 1.2) {
  const key = 'e' + color + intensity;
  let m = cache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity }); cache.set(key, m); }
  return m;
}
