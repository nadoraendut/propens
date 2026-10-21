// Seeded random numbers, so a draw can be shown and repeated: same people + settings + seed = same list.
export const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000_000

/** mulberry32: small, fast, good enough for a lottery among equals. Returns { random(), choice(array) }. */
export function makeRng(seed) {
  let a = Number(seed) >>> 0
  const random = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { random, choice: (arr) => arr[Math.floor(random() * arr.length)] }
}
