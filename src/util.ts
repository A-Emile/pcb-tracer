// Kleine Helfer ohne App-Abhängigkeiten
export const $ = (s: string): any => document.querySelector(s);

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
