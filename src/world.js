// Rendering primitives for the "no-artist" look: 3-band toon shading + inverted-hull ink outlines,
// with all static scenery merged into one vertex-coloured mesh (2 draw calls for the whole level).
import * as THREE from 'three';
import { G } from './state.js';

export const INK = 0x1b120c;
let grad = null;
export function gradientMap() {
  if (!grad) {
    grad = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat);
    grad.minFilter = grad.magFilter = THREE.NearestFilter;
    grad.needsUpdate = true;
  }
  return grad;
}
export const toon = (color, opts = {}) => new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });
export const inkMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

const _s = new THREE.Vector3(), _c = new THREE.Vector3();

// Inverted hull: same geometry, scaled out by a constant world thickness, back faces only.
export function outline(mesh, t = 0.035, mat = inkMat) {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  g.boundingBox.getSize(_s); g.boundingBox.getCenter(_c);
  const o = new THREE.Mesh(g, mat);
  o.scale.set((_s.x + 2 * t) / Math.max(_s.x, 1e-3), (_s.y + 2 * t) / Math.max(_s.y, 1e-3), (_s.z + 2 * t) / Math.max(_s.z, 1e-3));
  o.position.set(_c.x * (1 - o.scale.x), _c.y * (1 - o.scale.y), _c.z * (1 - o.scale.z));
  o.raycast = () => {};
  o.userData.isOutline = true;
  mesh.add(o);
  return o;
}

// deterministic hash so shared vertices of non-indexed geometry jitter identically (no cracks)
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

export function jitter(geo, amt, seed = 0) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const qx = Math.round(x * 1000) / 1000, qy = Math.round(y * 1000) / 1000, qz = Math.round(z * 1000) / 1000;
    p.setXYZ(i,
      x + (hash3(qx + seed, qy, qz) - 0.5) * amt,
      y + (hash3(qy, qz + seed, qx) - 0.5) * amt,
      z + (hash3(qz, qx, qy + seed) - 0.5) * amt);
  }
  p.needsUpdate = true;
  return geo;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _col = new THREE.Color();

export class StaticBatch {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.opos = []; }

  // geo is consumed (local space). color: hex. outlineT: world thickness (0 = none). faceVar: per-triangle tint variation.
  add(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 }, color, outlineT = 0.06, faceVar = 0.07) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    _m.compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    if (outlineT > 0) {
      const og = g.clone();
      og.computeBoundingBox(); og.boundingBox.getSize(_s); og.boundingBox.getCenter(_c);
      og.translate(-_c.x, -_c.y, -_c.z);
      og.scale((_s.x * sx + 2 * outlineT) / Math.max(_s.x * sx, 1e-3), (_s.y * sy + 2 * outlineT) / Math.max(_s.y * sy, 1e-3), (_s.z * sz + 2 * outlineT) / Math.max(_s.z * sz, 1e-3));
      og.translate(_c.x, _c.y, _c.z);
      og.applyMatrix4(_m);
      this.opos.push(og.attributes.position.array);
    }
    g = g.clone(); g.applyMatrix4(_m); g.computeVertexNormals();
    const n = g.attributes.position.count;
    const cols = new Float32Array(n * 3);
    _col.setHex(color);
    for (let i = 0; i < n; i += 3) {
      const v = 1 + (Math.random() - 0.5) * 2 * faceVar;
      for (let k = 0; k < 3; k++) { cols[(i + k) * 3] = _col.r * v; cols[(i + k) * 3 + 1] = _col.g * v; cols[(i + k) * 3 + 2] = _col.b * v; }
    }
    this.pos.push(g.attributes.position.array); this.nor.push(g.attributes.normal.array); this.col.push(cols);
  }

  build(scene) {
    const cat = arrs => { const out = new Float32Array(arrs.reduce((s, a) => s + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(cat(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(cat(this.nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(cat(this.col), 3));
    const mesh = new THREE.Mesh(g, toon(0xffffff, { vertexColors: true }));
    scene.add(mesh);
    if (this.opos.length) {
      const og = new THREE.BufferGeometry();
      og.setAttribute('position', new THREE.BufferAttribute(cat(this.opos), 3));
      scene.add(new THREE.Mesh(og, inkMat));
    }
    return mesh;
  }
}

// ---------- colliders (bullets, projectiles, grenades) ----------
export function boxCollider(cx, cy, cz, w, h, d, ry = 0) {
  // rotated boxes collapse to their axis-aligned bounds; good enough for cover
  const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
  const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
  G.colliders.push({ type: 'box', min: new THREE.Vector3(cx - hw, cy, cz - hd), max: new THREE.Vector3(cx + hw, cy + h, cz + hd) });
}
export function sphereCollider(x, y, z, r) { G.colliders.push({ type: 'sphere', c: new THREE.Vector3(x, y, z), r }); }

// ---------- sky + lights ----------
export function buildSky(scene) {
  const sunDir = new THREE.Vector3(-0.35, 0.42, -0.84).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x2f7fd0) }, mid: { value: new THREE.Color(0xf6c98e) }, low: { value: new THREE.Color(0xe7a36a) },
      sunDir: { value: sunDir },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 sunDir; varying vec3 vP;
      void main(){
        vec3 d = normalize(vP); float h = d.y;
        vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h * 1.6, 0.0, 1.0), 0.7)) : mix(mid, low, clamp(-h * 4.0, 0.0, 1.0));
        float s = dot(d, sunDir);
        c += vec3(1.0, 0.75, 0.45) * pow(max(s, 0.0), 12.0) * 0.35;
        c = mix(c, vec3(1.0, 0.97, 0.86), smoothstep(0.99865, 0.9989, s));
        float ring = smoothstep(0.9983, 0.99845, s) * (1.0 - smoothstep(0.99865, 0.9988, s));
        c = mix(c, vec3(0.106, 0.07, 0.047), ring * 0.9);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog(0xf0bf88, 70, 320);

  const hemi = new THREE.HemisphereLight(0xbfe0ff, 0xc28a55, 1.5);
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
  sun.position.copy(sunDir).multiplyScalar(100);
  scene.add(hemi, sun);
  return { sky, sunDir };
}
