// ---------------------------------------------------------------- Shader (GLSL ES 3.0)
// Kacheln: Vertex aPos in Platinen-/Bildkoordinaten, Kamera uC (Mitte), uS (Maßstab), uHalf (halbe Fenstergröße in CSS-px),
// uR: Drehen/Spiegeln der Ansicht als 2×2 zeilenweise (view/camera.ts vm())
export const VS = `#version 300 es
in vec2 aPos; in vec2 aUV; uniform vec2 uC; uniform float uS; uniform vec2 uHalf; uniform vec4 uR; out vec2 vUV;
void main(){ vec2 q=(aPos-uC)*uS, p=vec2(uR.x*q.x+uR.y*q.y,uR.z*q.x+uR.w*q.y)/uHalf; gl_Position=vec4(p.x,-p.y,0.,1.); vUV=aUV; }`;
export const FS_BASE = `#version 300 es
precision mediump float; in vec2 vUV; uniform sampler2D uT; uniform float uA; out vec4 o;
void main(){ o=vec4(texture(uT,vUV).rgb,uA); }`;
// Hauptansicht, eine Lage, mit Material-Maske (uOn): Sichtbarkeit pro Klasse uVis = (Kupfer, Fläche, Druck, Rest), Platinengrund
// außerhalb des Umrisses uOutV. uFill: Druck durch die Farbe der Umgebung ersetzen (zwei Ringe, nur Nicht-Druck zählt),
// die Sichtbarkeit dort folgt der Umgebung (Druck auf Kupfer bleibt Kupfer). uTint: andere Lagen in Lagenfarbe.
// uMT/uGT: Kachel-UV → UV der Masken-Kachel bzw. der Umriss-Maske (ganzes Bild). Ohne Maske: Foto wie es ist.
// Maske vormultipliziert (material/gpu.ts): A = 0 = dort noch nicht gerechnet → Foto (nur der Umriss wirkt schon).
export const FS_MAT = `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uT; uniform sampler2D uM; uniform sampler2D uO; uniform float uA;
uniform float uOn; uniform float uFill; uniform float uOutV; uniform vec4 uMT; uniform vec4 uGT; uniform vec4 uVis; uniform vec4 uTint; uniform vec2 uRing; out vec4 o;
const vec2 RG[6]=vec2[6](vec2(1.,0.),vec2(.5,.866),vec2(-.5,.866),vec2(-1.,0.),vec2(-.5,-.866),vec2(.5,-.866));
float vis(vec3 m){ return m.r*uVis.x+m.g*uVis.y+m.b*uVis.z+max(1.-m.r-m.g-m.b,0.)*uVis.w; }
void main(){ vec3 c=texture(uT,vUV).rgb;
  if(uOn<.5){ o=vec4(c,uA); return; }
  vec2 mu=uMT.xy+vUV*uMT.zw; vec4 m4=texture(uM,mu); vec3 m=m4.a>.004?m4.rgb/m4.a:vec3(0.); float bo=texture(uO,uGT.xy+vUV*uGT.zw).r;
  vec2 ts=vec2(textureSize(uT,0)), ms=vec2(textureSize(uM,0))*uMT.zw, dx=dFdx(vUV), dy=dFdy(vUV);
  float lt=max(log2(max(length(dx*ts),length(dy*ts))),0.)+.5, lm=max(log2(max(length(dx*ms),length(dy*ms))),0.)+.5;
  float a=mix(1.,vis(m),m4.a);
  if(uFill>.5 && m.b>.01){ vec3 acc=vec3(0.); float wa=0., va=0.;
    for(int k=1;k<=2;k++) for(int i=0;i<6;i++){ vec2 u=vUV+(k==1?RG[i]:-RG[i])*uRing*(float(k)+.5);
      vec4 q4=textureLod(uM,uMT.xy+u*uMT.zw,lm); vec3 mm=q4.a>.004?q4.rgb/q4.a:vec3(0.); float w=max(1.-2.5*mm.b,0.)*(k==1?1.:.6);
      acc+=textureLod(uT,u,lt).rgb*w; wa+=w; va+=w*vis(vec3(mm.rg,0.)); }
    if(wa>.05){ float h=smoothstep(.02,.2,m.b); c=mix(c,acc/wa,h); a=mix(a,va/wa,h); } }
  a=a*bo+uOutV*(1.-bo);
  if(uTint.w>0.){ float y=dot(c,vec3(.299,.587,.114)); c=mix(c,uTint.rgb*clamp(.3+1.25*y,0.,1.3),uTint.w); }
  o=vec4(clamp(c,0.,1.),uA*clamp(a,0.,1.)); }`;
// Vollbild-Dreieck für die Filter-Durchgänge
export const VQ = `#version 300 es
void main(){ vec2 p=vec2(gl_VertexID==1?3.:-1.,gl_VertexID==2?3.:-1.); gl_Position=vec4(p,0.,1.); }`;
// Gauß-Unschärfe (eine Richtung), Quelle in Mip-Stufe uLod, 17 Abgriffe
export const FS_BLUR = `#version 300 es
precision mediump float; uniform sampler2D uSrc; uniform float uLod; uniform vec2 uDir; uniform vec2 uInv; uniform float uW[9]; out vec4 o;
void main(){ vec2 uv=gl_FragCoord.xy*uInv; vec3 s=textureLod(uSrc,uv,uLod).rgb*uW[0];
  for(int i=1;i<9;i++){ vec2 d=float(i)*uDir; s+=(textureLod(uSrc,uv+d,uLod).rgb+textureLod(uSrc,uv-d,uLod).rgb)*uW[i]; }
  o=vec4(s,1.); }`;
// „Bahnen deutlicher“: nur Helligkeit, Detail d = Y(Bild) − Y(Unschärfe) weich begrenzt: + k·d/(1+c·|d|).
// Kleine Unterschiede (Bahn gegen Lack) werden voll verstärkt, große Sprünge (Bauteil, Bohrung) kaum → schwache Lichthöfe.
export const FS_COMP = `#version 300 es
precision mediump float; uniform sampler2D uA; uniform sampler2D uB; uniform vec2 uInv; uniform float uK; uniform float uC; out vec4 o;
void main(){ vec3 a=texelFetch(uA,ivec2(gl_FragCoord.xy),0).rgb, b=texture(uB,gl_FragCoord.xy*uInv).rgb;
  float d=dot(a-b,vec3(.299,.587,.114));
  o=vec4(clamp(a+uK*d/(1.+uC*abs(d)),0.,1.),1.); }`;
// Linien (Zeichnungen): Band in Platinenkoordinaten, Breite uW in Bildschirm-px, runde Kappen über vQ.
// Bahnen (uB = 1): dazu halbe Breite aD in Platinen-px (mindestens 1 px am Bildschirm), uW ist dann der Saum.
export const LINE_VS = `#version 300 es
in vec2 aPos; in vec2 aN; in vec2 aQ; in float aD; in vec4 aC;
uniform vec2 uC; uniform float uS; uniform vec2 uHalf; uniform float uW; uniform vec2 uOff; uniform vec4 uR; uniform float uB;
out vec2 vQ; out float vD; out vec4 vC;
void main(){ vec2 q=(aPos+uOff-uC)*uS+aN*(uW*.5+uB*max(aD*uS,1.)), p=vec2(uR.x*q.x+uR.y*q.y,uR.z*q.x+uR.w*q.y)/uHalf; gl_Position=vec4(p.x,-p.y,0.,1.); vQ=aQ; vD=aD; vC=aC; }`;
export const LINE_FS = `#version 300 es
precision highp float; in vec2 vQ; in float vD; in vec4 vC; uniform float uS; uniform vec4 uCol; uniform float uMix; out vec4 o;
void main(){ float r=length(vQ), fw=max(fwidth(r),1e-3), a=1.-smoothstep(1.-fw,1.+fw*.5,r);
  if(a<.03) discard;
  o=vec4(mix(vC.rgb,uCol.rgb,uMix), uCol.a*a*vC.a); }`;
