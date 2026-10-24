// Gauß mit Spaltenpivot; A zeilenweise N×N, rhs: Liste von Vektoren. null bei Singularität.
export function solveLin(Ain, N, rhs) {
  const A = Float64Array.from(Ain), B = rhs.map(v => Float64Array.from(v));
  for (let k = 0; k < N; k++) {
    let p = k, m = Math.abs(A[k * N + k]);
    for (let i = k + 1; i < N; i++) { const v = Math.abs(A[i * N + k]); if (v > m) { m = v; p = i; } }
    if (m < 1e-12) return null;
    if (p !== k) {
      for (let j = 0; j < N; j++) { const t = A[k * N + j]; A[k * N + j] = A[p * N + j]; A[p * N + j] = t; }
      for (const b of B) { const t = b[k]; b[k] = b[p]; b[p] = t; }
    }
    for (let i = k + 1; i < N; i++) {
      const f = A[i * N + k] / A[k * N + k];
      if (!f) continue;
      for (let j = k; j < N; j++) A[i * N + j] -= f * A[k * N + j];
      for (const b of B) b[i] -= f * b[k];
    }
  }
  for (const b of B) for (let i = N - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < N; j++) s -= A[i * N + j] * b[j];
    b[i] = s / A[i * N + i];
  }
  return B;
}
