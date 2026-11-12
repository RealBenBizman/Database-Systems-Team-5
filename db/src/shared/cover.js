// Placeholder cover art for products that have no image yet: a gradient picked from the product id or name,
// so the same product always gets the same colors.
const PALETTES = [
  ['#1b2a6b', '#7a2fd0', '#ff4fa3'],
  ['#04323d', '#0b6b86', '#3fe0ff'],
  ['#2a0c0c', '#7a1f1f', '#e0562b'],
  ['#06303a', '#0d7a80', '#3fd3c0'],
  ['#0a0f3a', '#23308f', '#5a7bff'],
  ['#10062a', '#3b1470', '#2ab6d8'],
];

export function coverGradient(seed) {
  const text = String(seed ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  const [a, b, c] = PALETTES[hash % PALETTES.length];
  const angle = 150 + (hash % 5) * 10;
  return `linear-gradient(${angle}deg, ${a}, ${b} 60%, ${c})`;
}
