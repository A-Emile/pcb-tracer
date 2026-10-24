import { rebuildBoard } from './board';
import { affApply, affFit, affInv, affMul, fitMap, preMatrix } from './geometry';
import { saveSoon } from '../db/projects';
import { objsReanchor } from '../draw/objects';
import { dirty } from '../render/frame';
import { meshCache } from '../render/tiles';
import { S } from '../state';
import { $ } from '../util';

// ---------------------------------------------------------------- Ausrichtung
export function rebuildAlign() {
  const p = S.proj, fs = p.sides.front, bs = p.sides.back;
  rebuildBoard();
  S.pre = preMatrix(p.align.pre, bs.w, bs.h);
  S.preInv = affInv(S.pre.m);
  const base = affMul([1, 0, (fs.w - S.pre.w) / 2, 0, 1, (fs.h - S.pre.h) / 2], S.pre.m), ibase = affInv(base);
  const B = p.align.pairs.map(q => q.b), F = p.align.pairs.map(q => q.f);
  S.fwd = fitMap(B, F, base, true);
  S.inv = fitMap(F, B, ibase);
  S.loo = S.fwd.loo ? Array.from(S.fwd.loo) : p.align.pairs.map((q, i) => {
    if (B.length < 4) return null;
    const m = fitMap(B.filter((_, j) => j !== i), F.filter((_, j) => j !== i), base), r = m(q.b[0], q.b[1]);
    return Math.hypot(r[0] - q.f[0], r[1] - q.f[1]);
  });
  S.alignVer++;
  meshCache.clear();
  objsReanchor();
  updateAlignBar();
  dirty();
}
export function pushUndo() { S.undo.push(JSON.stringify(S.proj.align)); if (S.undo.length > 100) S.undo.shift(); }
export function setPre(pre) {
  const cam = S.cams.back, raw = cam ? affApply(S.preInv, cam.cx, cam.cy) : null;
  S.proj.align.pre = pre;
  rebuildAlign();
  if (raw) { const q = affApply(S.pre.m, raw[0], raw[1]); cam.cx = q[0]; cam.cy = q[1]; }
  saveSoon();
}
// ab 3 Paaren: Anzeige der Rückseite so drehen/spiegeln, dass sie wie die Vorderseite liegt
export function autoOrient() {
  const pr = S.proj.align.pairs;
  if (pr.length < 3) return;
  const A = affFit(pr.map(q => q.b), pr.map(q => q.f));
  if (!A) return;
  const bs = S.proj.sides.back;
  const rate = pre => {
    const L = preMatrix(pre, bs.w, bs.h).m, Li = affInv(L), M = affMul(A, Li);
    return (M[0] + M[4]) / Math.sqrt(Math.abs(M[0] * M[4] - M[1] * M[3]));
  };
  let best = S.proj.align.pre, bs0 = rate(best);
  for (const fx of [false, true]) for (let rot = 0; rot < 4; rot++) {
    const c = { fx, fy: false, rot }, v = rate(c);
    if (v > bs0 + 1e-3) { bs0 = v; best = c; }
  }
  if (best !== S.proj.align.pre) setPre(best);
}
export function looColor(e) { return e == null ? '#ffffff' : e <= 4 ? '#3ecf72' : e <= 8 ? '#ffc53d' : '#ff5a5a'; }
export function updateAlignBar() {
  if (S.mode !== 'align') return;
  const pr = S.proj.align.pairs, n = pr.length;
  let txt;
  if (S.sel != null) {
    const e = S.loo[S.sel];
    txt = `Paar ${S.sel + 1}` + (e != null ? ` · Abweichung <b style="color:${looColor(e)}">${e.toFixed(1)} px</b>` : '') + ' · Punkt ziehen zum Verschieben';
  } else if (S.pending) {
    txt = S.pending.front && S.pending.back ? (S.pending.backProp || S.pending.frontProp ? 'Vorschlag prüfen – passt das Gegenstück?' : '')
        : S.pending.front ? 'Jetzt dasselbe Via <b>unten</b> antippen' : 'Jetzt dasselbe Via <b>oben</b> antippen';
  } else if (S.suggesting) txt = $('#aStatus').innerHTML;
  else if (S.props && S.props.length) txt = `<b>${S.props.length}</b> weitere Via-Paare gefunden (gestrichelt)`;
  else if (n === 0) txt = 'Ein Via oben antippen, dann dasselbe unten. Unten mit ⇆ ⇅ ⟳ passend drehen.';
  else if (n >= 4 && n < 8) txt = `<b>${n}</b> Paare · jetzt ✨ Vorschläge holen`;
  else if (n < 4) txt = `<b>${n}</b> Paare · noch ${4 - n} bis zur Kontrolle`;
  else {
    let mx = 0, mi = 0;
    S.loo.forEach((e, i) => { if (e > mx) { mx = e; mi = i; } });
    txt = `<b>${n}</b> Paare · größte Abweichung <b style="color:${looColor(mx)}">${mx.toFixed(1)} px</b> (Paar ${mi + 1})`;
  }
  $('#aStatus').innerHTML = txt;
  $('#aRowProps').hidden = !(S.props && S.props.length) || !!S.pending || S.sel != null;
  $('#aAcceptAll').textContent = `✓ Alle ${S.props ? S.props.length : ''} übernehmen`;
  for (const id of ['#aFlipX', '#aFlipY', '#aRot']) $(id).hidden = n >= 4;
  $('#aSuggest').hidden = n < 4;
  $('#aSuggest').disabled = !!S.suggesting;
  $('#aRowPending').hidden = !(S.pending && S.sel == null);
  $('#aAccept').disabled = !(S.pending && S.pending.front && S.pending.back);
  $('#aRowSel').hidden = S.sel == null;
  $('#aRowIdle').hidden = !$('#aRowPending').hidden || !$('#aRowSel').hidden || !$('#aRowProps').hidden;
  $('#aUndo').disabled = !S.undo.length;
  $('#aLink').classList.toggle('on', S.link);
}
