import { updateAlignBar } from './align';
import { fitMap } from './geometry';
import { VSTRIDE, getVias, snapRaw, viaProg } from './snap';
import { dirty } from '../render/frame';
import { S } from '../state';
import { toast } from '../ui/toast';
import { $ } from '../util';

// Weitere Via-Paare vorschlagen: Vias beider Seiten über die aktuelle Zuordnung gegenseitig zuordnen
export async function suggestPairs() {
  const pr = S.proj.align.pairs;
  if (pr.length < 4 || S.suggesting) return;
  S.suggesting = true; updateAlignBar();
  const st = $('#aStatus'), prog = () => { st.innerHTML = `Suche Vias auf beiden Seiten … ${Math.round(50 * ((viaProg.front || 0) + (viaProg.back || 0)))} %`; };
  try {
    prog();
    const [af, ab] = await Promise.all([getVias('front', prog), getVias('back', prog)]);
    if (!af || !ab) { toast('Via-Suche fehlgeschlagen.'); return; }
    // Wie sieht ein Via auf dieser Platine aus? Vorbild sind die von Hand gesetzten Paare (je Seite)
    // (von Hand gesetzte zuerst, dazu übernommene Vorschläge; Messwerte werden am Paar gemerkt)
    const ex = { front: [], back: [] };
    const sample = [...pr.filter(q => !q.auto).slice(0, 16), ...pr.filter(q => q.auto).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 16)) === 0).slice(0, 16)];
    for (const q of sample) {
      if (!q.zf) { const h = await snapRaw('front', q.f[0], q.f[1], 8, true); if (h && h.z) { q.zf = Array.from(h.z); q.zrf = h.r; } }
      if (!q.zb) { const h = await snapRaw('back', q.b[0], q.b[1], 8, true); if (h && h.z) { q.zb = Array.from(h.z); q.zrb = h.r; } }
      if (q.zf) ex.front.push({ z: q.zf, r: q.zrf });
      if (q.zb) ex.back.push({ z: q.zb, r: q.zrb });
    }
    const cd = (z, e, o) => Math.hypot(z[o] - e[o], z[o + 1] - e[o + 1], z[o + 2] - e[o + 2]);
    const like = (a, side) => {
      const out = [];
      for (let i = 0; i < a.length; i += VSTRIDE) {
        const r = a[i + 2], z = a.subarray(i + 4, i + 14);
        if (z[9] < 20) continue;
        if (ex[side].length && !ex[side].some(e => cd(z, e.z, 3) <= 28 && cd(z, e.z, 0) <= 40 && cd(z, e.z, 6) <= 45 && r / e.r > 0.6 && r / e.r < 1.6)) continue;
        out.push(a[i], a[i + 1], r, a[i + 3]);
      }
      return Float32Array.from(out);
    };
    const vf = like(af, 'front'), vb = like(ab, 'back');
    S.viaDebug = { vf, vb };
    const nb = vb.length / 4, cell = 64, grid = new Map();
    for (let k = 0; k < nb; k++) {
      const key = Math.floor(vb[4 * k] / cell) + ',' + Math.floor(vb[4 * k + 1] / cell);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(k);
    }
    // nächstes und zweitnächstes Via der Rückseite
    const nearBack = (x, y, R) => {
      let best = -1, bd = Infinity, d2 = Infinity;
      for (let gy = Math.floor((y - R) / cell); gy <= Math.floor((y + R) / cell); gy++)
        for (let gx = Math.floor((x - R) / cell); gx <= Math.floor((x + R) / cell); gx++)
          for (const k of grid.get(gx + ',' + gy) || []) {
            const d = Math.hypot(vb[4 * k] - x, vb[4 * k + 1] - y);
            if (d < bd) { d2 = bd; bd = d; best = k; } else if (d < d2) d2 = d;
          }
      return bd <= R ? { k: best, d: bd, d2 } : null;
    };
    const userF = pr.map(q => q.f), userB = pr.map(q => q.b), ID = [1, 0, 0, 0, 1, 0];
    // nur eindeutige, gegenseitige Zuordnungen
    const match = (fwd, inv, R) => {
      const byB = new Map();
      for (let j = 0; j < vf.length / 4; j++) {
        const x = vf[4 * j], y = vf[4 * j + 1], r = vf[4 * j + 2];
        if (userF.some(f => Math.hypot(f[0] - x, f[1] - y) < 2 * r + 4)) continue;
        const p = inv(x, y), m = nearBack(p[0], p[1], R);
        if (!m || m.d2 < Math.max(2 * m.d, m.d + 0.6 * R)) continue;
        const bx = vb[4 * m.k], by = vb[4 * m.k + 1], rb = vb[4 * m.k + 2], q = fwd(bx, by);
        if (Math.hypot(q[0] - x, q[1] - y) > R) continue;
        if (Math.abs(r - rb) > 0.4 * Math.max(r, rb)) continue;
        const o = { f: [x, y], b: [bx, by], rf: r, rb, d: m.d }, prev = byB.get(m.k);
        if (prev) { byB.set(m.k, null); continue; }
        byB.set(m.k, o);
      }
      return [...byB.values()].filter(Boolean);
    };
    // Ausreißer entfernen: Leave-one-out jedes Vorschlags gegen alle übrigen Paare
    const clean = props => {
      for (let it = 0; it < 12 && props.length; it++) {
        const B = [...userB, ...props.map(o => o.b)], F = [...userF, ...props.map(o => o.f)];
        const f = fitMap(B, F, ID, true);
        if (!f.loo) break;
        const e = props.map((o, i) => (o.e = f.loo[userB.length + i]));
        // Maßstab: bei schon vielen Paaren deren Genauigkeit, sonst die der Vorschläge
        const ref = userB.length >= 20 ? Array.from(f.loo.slice(0, userB.length)) : e;
        const med = ref.slice().sort((a, b) => a - b)[ref.length >> 1], thr = Math.max(4, 2.5 * med);
        const bad = props.filter(o => o.e > thr).sort((a, b) => b.e - a.e);
        if (!bad.length) break;
        const drop = new Set(bad.slice(0, Math.max(1, Math.ceil(0.15 * props.length))));
        props = props.filter(o => !drop.has(o));
      }
      return props;
    };
    let props = clean(match(S.fwd, S.inv, 40));
    for (let round = 0; round < 2 && props.length >= 4; round++) {
      const B = [...userB, ...props.map(o => o.b)], F = [...userF, ...props.map(o => o.f)];
      props = clean(match(fitMap(B, F, ID), fitMap(F, B, ID), 15));
    }
    S.props = props;
    if (!props.length) toast('Keine weiteren sicheren Via-Paare gefunden. Setze ein paar Paare von Hand in den Bereichen, die noch nicht passen.', 5000);
  } finally {
    S.suggesting = false; updateAlignBar(); dirty();
  }
}
