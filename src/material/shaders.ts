// ---------------------------------------------------------------- Shader der Material-Erkennung auf der GPU (GLSL ES 3.0)
// Alle Durchgänge: Vollbild-Dreieck (render/shaders.ts VQ) über einen Block der Größe uSz (Kachel der Stufe a plus Rand Mg),
// gelesen mit texelFetch, außerhalb des Blocks gilt der nächste Wert (wie mBlur). Ablauf und Belegung der Texturen: material/gpu.ts.
// Die Rechnung je Pixel ist die des früheren mClassify (CPU, Worker); in 32-Bit-Float bis auf ±1/255 gleich.

// gemeinsamer Kopf aller Fragment-Shader
export const MG_HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform ivec2 uSz;
ivec2 P(){ return ivec2(gl_FragCoord.xy); }
vec4 F(sampler2D s, ivec2 p){ return texelFetch(s, clamp(p, ivec2(0), uSz-1), 0); }
float SS(float a, float b, float x){ return smoothstep(a, b, x); }
`;

// name → [Fragment-Shader ohne Kopf, Uniform-Namen außer uSz]
export const MG_FS: Record<string, [string, string[]]> = {
  // Kacheln der Stufe a in den Block kopieren (später gezeichnete überschreiben frühere, wie rgbBlock)
  copy: [`uniform sampler2D uT; uniform ivec2 uOff; out vec4 o; void main(){ o=texelFetch(uT,P()-uOff,0); }`, ['uT', 'uOff']],
  // sRGB → Lab (wie mLab), minus Helligkeitsausgleich (off, Stufe c, bilinear); X = (L−Lc, (L−Lc)²) für die Textur-Streuung
  lab: [`uniform sampler2D uSrc; uniform sampler2D uOffT; uniform vec4 uOM; uniform float uLc; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
float lin(float c){ return c<=0.04045 ? c/12.92 : pow((c+0.055)/1.055,2.4); }
float fl(float t){ return t>0.008856 ? pow(t,1./3.) : 7.787*t+0.137931; }
void main(){ vec3 c=texelFetch(uSrc,P(),0).rgb; float r=lin(c.r),g=lin(c.g),b=lin(c.b);
  float fx=fl((0.412453*r+0.357580*g+0.180423*b)/0.950456), fy=fl(0.212671*r+0.715160*g+0.072169*b), fz=fl((0.019334*r+0.119193*g+0.950227*b)/1.088754);
  float ill=texture(uOffT,uOM.xy+(vec2(P())+.5)*uOM.zw).r, L=116.*fy-16.-ill;
  o0=vec4(L,500.*(fx-fy),200.*(fy-fz),0.); o1=vec4(L-uLc,(L-uLc)*(L-uLc),0.,0.); }`, ['uSrc', 'uOffT', 'uOM', 'uLc']],
  // X neu aus geglättetem L (nur bei s0 > 0,8)
  x: [`uniform sampler2D uT0; uniform float uLc; out vec4 o; void main(){ float L=texelFetch(uT0,P(),0).x; o=vec4(L-uLc,(L-uLc)*(L-uLc),0.,0.); }`, ['uT0', 'uLc']],
  // Gauß in eine Richtung, Gewichte je Kanal (σ = 0: Kanal unverändert)
  blur: [`uniform sampler2D uSrc; uniform ivec2 uDir; uniform int uR; uniform vec4 uW[49]; out vec4 o;
void main(){ ivec2 p=P(); vec4 s=F(uSrc,p)*uW[0]; for(int i=1;i<=uR;i++) s+=(F(uSrc,p+uDir*i)+F(uSrc,p-uDir*i))*uW[i]; o=s; }`, ['uSrc', 'uDir', 'uR', 'uW']],
  // Pixel-Klassen (Schleife 1 des früheren mClassify)
  cls: [`uniform sampler2D uT0; uniform sampler2D uBL; uniform vec3 uLack; uniform vec3 uCu; uniform float uC0; uniform float uBare;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; layout(location=2) out vec4 o2;
void main(){ vec3 x=texelFetch(uT0,P(),0).xyz; vec2 bl=texelFetch(uBL,P(),0).xy; float l=x.x, a=x.y, b=x.z;
  float te=sqrt(max(bl.y-bl.x*bl.x,0.));
  vec3 d=uCu-uLack, e=x-uLack; float dd=dot(d,d); if(dd==0.) dd=1.; float t=dot(e,d)/dd, tc=clamp(t,-.4,1.4);
  vec3 q=e-tc*d; q.x*=.5; float f=exp(-dot(q,q)/49.);
  float Lref=uCu.x, Llo=uLack.x, C0=uC0, pc=SS(.35,.65,t), nf=1.-f;
  float Cc=length(vec2(a,b)), unbunt=1.-SS(.35*C0+6.,.55*C0+12.,Cc), grau=1.-SS(.25*C0+2.,.25*C0+6.,Cc);
  float si=nf*unbunt*SS(Lref+12.,Lref+24.,l)*(1.-SS(5.,10.,te));
  float hue=Cc>1e-6 ? atan(b,a)*57.29578 : 0.;
  float ch=SS(6.,12.,Cc)*SS(15.,30.,hue)*(1.-SS(75.,90.,hue))*SS(Lref-15.,Lref-5.,l);
  float me=nf*max(grau*SS(Lref-2.,Lref+10.,l)*SS(4.,9.,te),ch);
  me=max(me,nf*unbunt*SS(Lref+35.,Lref+50.,l)*SS(10.,16.,te));
  float dk=nf*(1.-SS(Llo-14.,Llo-6.,l)), cv=f*pc, la=f*(1.-pc), nf2=nf;
  if(uBare>.5){ float cub=ch*SS(Llo-5.,Llo+10.,l); cv=max(cv*(1.-cub),cub); la*=1.-cub; nf2=nf*(1.-cub); me=max(me*(1.-cub),si*(1.-cub)); si=0.; ch=0.; }
  o0=vec4(cv,la,me,si); o1=vec4(dk,nf2,ch,0.); o2=vec4(ch*nf2,si,te,0.); }`, ['uT0', 'uBL', 'uLack', 'uCu', 'uC0', 'uBare']],
  // große warme Flecken → Bauteil, helle runde Flecken (Lötzinn) → Metall (Schleifen 2 und 3)
  ws: [`uniform sampler2D uC1; uniform sampler2D uC2; uniform sampler2D uBW; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
void main(){ vec4 c1=texelFetch(uC1,P(),0), c2=texelFetch(uC2,P(),0); vec3 bw=texelFetch(uBW,P(),0).xyz;
  float w=SS(.55,.75,bw.x), comp=max(c2.x,c2.y*w*c2.z), metal=c1.z*(1.-w);
  float k=SS(.62,.75,bw.y)*c1.w; metal+=k; float silk=c1.w-k;
  o0=vec4(c1.x,c1.y,metal,silk); o1=vec4(comp,c2.y,bw.z,silk); }`, ['uC1', 'uC2', 'uBW']],
  // Druckkanten, Normierung, cuall (Schleife 4)
  norm: [`uniform sampler2D uZ; uniform sampler2D uC2; out vec4 o;
void main(){ vec4 z4=texelFetch(uZ,P(),0), c2=texelFetch(uC2,P(),0); float cu=z4.x, lack=z4.y, metal=z4.z, comp=c2.x, nfA=c2.y, tex=c2.z, silk=c2.w;
  float z=SS(.08,.25,z4.w)*(1.-SS(10.,16.,tex)), si=max(silk,metal*z*.9), me=metal*(1.-z);
  float rest=clamp(nfA-si-me-comp,0.,1.), la=lack+.5*rest, s=max(la+cu+me+si+comp,1e-4);
  cu/=s; me/=s; si/=s; o=vec4(cu,me,si,cu+.6*si+.6*me); }`, ['uZ', 'uC2']],
  // Kupferfläche: Kern (Mittel in 2 tw hoch) und „ok“ (Kupfer) als Startwerte der Dilatation
  seed: [`uniform sampler2D uD; uniform sampler2D uE; out vec4 o;
void main(){ o=vec4(texelFetch(uE,P(),0).w>.72?1.:0., texelFetch(uD,P(),0).w>.35?1.:0., 0., 1.); }`, ['uD', 'uE']],
  // 3×3-Dilatation (außerhalb des Blocks = 0), wahlweise nur durch Kupfer (ok)
  dil: [`uniform sampler2D uG; uniform float uOk; out vec4 o;
void main(){ ivec2 p=P(); float r=0.; for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ ivec2 q=p+ivec2(i,j); if(all(greaterThanEqual(q,ivec2(0)))&&all(lessThan(q,uSz))) r=max(r,texelFetch(uG,q,0).r); }
  float ok=texelFetch(uG,p,0).g; o=vec4(uOk>.5?r*ok:r, ok, 0., 1.); }`, ['uG', 'uOk']],
  // Ergebnis R (Kupfer ohne Fläche), G (Fläche), B (Druck, etwas weiter gefasst), A = 1; nur der Kachel-Inhalt (Versatz uO)
  fin: [`uniform sampler2D uD; uniform sampler2D uE; uniform sampler2D uG; uniform ivec2 uO; out vec4 o;
void main(){ ivec2 p=P()+uO; vec4 d=texelFetch(uD,p,0); float hs=texelFetch(uE,p,0).z, reg=texelFetch(uG,p,0).r;
  float cu=d.x, pp=reg>.5?cu:0., r=min(1.,cu-pp+d.y), b=max(d.z,SS(.05,.25,hs)), k=r+pp>1.-b?(1.-b)/(r+pp):1.;
  o=vec4(r*k,pp*k,b,1.); }`, ['uD', 'uE', 'uG', 'uO']],
  // Kachel-Maske gemittelt in die Übersichts-Maske (Faktor uF = 2^(b−a))
  down: [`uniform sampler2D uT; uniform ivec2 uE0; uniform ivec2 uX0; uniform ivec2 uX1; uniform int uF; out vec4 o;
void main(){ ivec2 X=P(); vec3 s=vec3(0.); float k=0.;
  for(int dy=0;dy<8;dy++){ if(dy>=uF) break; for(int dx=0;dx<8;dx++){ if(dx>=uF) break; ivec2 q=X*uF+ivec2(dx,dy);
    if(any(lessThan(q,uX0))||any(greaterThanEqual(q,uX1))) continue; s+=texelFetch(uT,q-uE0,0).rgb; k+=1.; } }
  o=vec4(s/max(k,1.),1.); }`, ['uT', 'uE0', 'uX0', 'uX1', 'uF']],
};
