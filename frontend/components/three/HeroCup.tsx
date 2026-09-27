"use client";
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { latteArtTexture, marbleTextures, softDot } from "./textures";

type Quality = "high" | "low";

// ---------------------------------------------------------------- steam: soft noise ribbons that rise and curl
const steamVert = /* glsl */`varying vec2 vUv; uniform float uTime; uniform float uSeed;
void main(){ vUv = uv; vec3 p = position;
  p.x += sin(uv.y * 3.2 + uTime * .9 + uSeed) * .12 * uv.y + sin(uv.y * 7. + uTime * 1.7) * .03 * uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`;
const steamFrag = /* glsl */`varying vec2 vUv; uniform float uTime; uniform float uSeed;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec2 uv = vUv; float t = uTime * .35 + uSeed;
  float s = n(vec2(uv.x * 3., uv.y * 2.2 - t)) * .6 + n(vec2(uv.x * 7., uv.y * 5. - t * 1.6)) * .4;
  float edge = smoothstep(0., .35, uv.x) * smoothstep(1., .65, uv.x);
  float fade = smoothstep(0., .18, uv.y) * smoothstep(1., .35, uv.y);
  float a = smoothstep(.45, .85, s) * edge * fade * .32;
  gl_FragColor = vec4(vec3(1.), a); }`;

function Steam({ count }: { count: number }) {
  const mats = useMemo(() => Array.from({ length: count }, (_, i) => new THREE.ShaderMaterial({
    vertexShader: steamVert, fragmentShader: steamFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uSeed: { value: i * 2.37 } },
  })), [count]);
  const refs = useRef<THREE.Mesh[]>([]);
  const { camera } = useThree();
  useFrame((_, dt) => {
    mats.forEach((m) => { m.uniforms.uTime.value += dt; });
    refs.current.forEach((m) => { if (m) m.quaternion.copy(camera.quaternion); });   // always face the camera
  });
  return (
    <group position={[0, 0.72, 0]}>
      {mats.map((m, i) => (
        <mesh key={i} ref={(el) => { if (el) refs.current[i] = el; }} position={[(i - (count - 1) / 2) * .12, 0.85 + i * .05, 0]} material={m}>
          <planeGeometry args={[0.55, 1.7, 1, 24]} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- the cup, saucer and coffee
function Cup({ pointer }: { pointer: React.RefObject<{ x: number; y: number }> }) {
  const group = useRef<THREE.Group>(null);
  const surface = useRef<THREE.Mesh>(null);
  const { cupGeo, saucerGeo, art } = useMemo(() => {
    // porcelain cup: outer wall → rim → inner wall (lathe)
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 28; i++) { const t = i / 28; pts.push(new THREE.Vector2(0.3 + Math.sin(t * Math.PI * .5) * .24 + t * .03, t * 0.72)); }
    pts.push(new THREE.Vector2(0.585, 0.735));
    for (let i = 28; i >= 0; i--) { const t = i / 28; pts.push(new THREE.Vector2(0.27 + Math.sin(t * Math.PI * .5) * .24 + t * .03, 0.035 + t * 0.69)); }
    const cupGeo = new THREE.LatheGeometry(pts, 96);
    const sp: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(0.4, 0.0), new THREE.Vector2(0.72, 0.035), new THREE.Vector2(0.9, 0.09), new THREE.Vector2(0.93, 0.105),
      new THREE.Vector2(0.88, 0.1), new THREE.Vector2(0.7, 0.055), new THREE.Vector2(0.4, 0.035), new THREE.Vector2(0, 0.035)];
    const saucerGeo = new THREE.LatheGeometry(sp, 96);
    return { cupGeo, saucerGeo, art: latteArtTexture(512) };
  }, []);
  const base = useMemo(() => new THREE.CircleGeometry(0.53, 64, 0, Math.PI * 2), []);
  const basePos = useMemo(() => Float32Array.from(base.attributes.position.array), [base]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime(), p = pointer.current ?? { x: 0, y: 0 };
    if (group.current) {
      group.current.rotation.y += ((p.x * 0.5 + t * 0.05) - group.current.rotation.y) * 0.04;
      group.current.rotation.x += ((p.y * 0.08) - group.current.rotation.x) * 0.05;
    }
    // coffee surface: a very gentle ripple so it feels liquid
    const pos = base.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = basePos[i * 3], y = basePos[i * 3 + 1], r = Math.hypot(x, y);
      pos.setZ(i, Math.sin(r * 22 - t * 2.2) * 0.003 * (1 - r / .53));
    }
    pos.needsUpdate = true;
  });
  const porcelain = <meshPhysicalMaterial color="#fbf7f1" roughness={0.14} clearcoat={1} clearcoatRoughness={0.06} envMapIntensity={1.4} />;
  return (
    <group ref={group} position={[0, -0.02, 0]}>
      <mesh geometry={saucerGeo} castShadow receiveShadow>{porcelain}</mesh>
      <group position={[0, 0.035, 0]}>
        <mesh geometry={cupGeo} castShadow receiveShadow>{porcelain}</mesh>
        <mesh position={[0.6, 0.42, 0]} rotation={[0, 0, -0.35]} castShadow>
          <torusGeometry args={[0.16, 0.032, 20, 48, Math.PI * 1.3]} />{porcelain}
        </mesh>
        <mesh ref={surface} geometry={base} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.66, 0]}>
          <meshPhysicalMaterial map={art} roughness={0.32} clearcoat={0.6} clearcoatRoughness={0.2} />
        </mesh>
      </group>
    </group>
  );
}

function Table({ quality }: { quality: Quality }) {
  const tex = useMemo(() => marbleTextures(quality === "high" ? 1024 : 512), [quality]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
      <circleGeometry args={[9, 96]} />
      <meshPhysicalMaterial map={tex.map} roughnessMap={tex.roughnessMap} roughness={0.35} clearcoat={1} clearcoatRoughness={0.12} envMapIntensity={0.9} />
    </mesh>
  );
}

/** Warm out-of-focus café lights in the dark behind the table. */
function Bokeh({ count }: { count: number }) {
  const tex = useMemo(() => softDot("rgba(255,196,130,1)"), []);
  const dots = useMemo(() => Array.from({ length: count }, (_, i) => {
    const r = (k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };   // seeded, stable
    return { p: [(r(1) - .5) * 16, 0.6 + r(2) * 3.8, -5 - r(3) * 6] as [number, number, number], s: 0.25 + r(4) * 0.7, o: 0.18 + r(5) * 0.4, k: i };
  }), [count]);
  const refs = useRef<THREE.Sprite[]>([]);
  useFrame(({ clock }) => refs.current.forEach((s, i) => { if (s) (s.material as THREE.SpriteMaterial).opacity = dots[i].o * (0.8 + 0.2 * Math.sin(clock.elapsedTime * .6 + i)); }));
  return <>{dots.map((d, i) => (
    <sprite key={i} ref={(el) => { if (el) refs.current[i] = el; }} position={d.p} scale={d.s}>
      <spriteMaterial map={tex} transparent opacity={d.o} depthWrite={false} blending={THREE.AdditiveBlending} />
    </sprite>
  ))}</>;
}

/** The camera drifts with the pointer and the key light follows, so reflections slide across the porcelain and marble. */
function Rig({ pointer, x, compact }: { pointer: React.RefObject<{ x: number; y: number }>; x: number; compact?: boolean }) {
  const light = useRef<THREE.SpotLight>(null);
  useFrame(({ camera }) => {
    const p = pointer.current ?? { x: 0, y: 0 };
    camera.position.x += (x + p.x * 0.6 - camera.position.x) * 0.04;
    camera.position.y += ((compact ? 3.1 : 2.4) - p.y * 0.35 - camera.position.y) * 0.04;
    if (compact) camera.position.z += (7.4 - camera.position.z) * 0.04;
    camera.lookAt(x * 0.55, compact ? -0.9 : 0.45, 0);   // phones: look below the cup so it sits high, above the copy
    if (light.current) { light.current.position.x += (-2.5 + p.x * 4 - light.current.position.x) * 0.05; }
  });
  return <spotLight ref={light} position={[-2.5, 5, 3]} angle={0.5} penumbra={1} intensity={110} color="#ffe6cc" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />;
}

export default function HeroCup({ quality = "high", offsetX = 0, compact = false }: { quality?: Quality; offsetX?: number; compact?: boolean }) {
  const pointer = useRef({ x: 0, y: 0 });
  const high = quality === "high";
  useEffect(() => {   // follow the pointer anywhere on the page, not only over the canvas
    const on = (e: PointerEvent) => { pointer.current = { x: e.clientX / innerWidth - .5, y: e.clientY / innerHeight - .5 }; };
    addEventListener("pointermove", on, { passive: true }); return () => removeEventListener("pointermove", on);
  }, []);
  return (
    <Canvas
      shadows={high ? "percentage" : false} dpr={high ? [1, 2] : [1, 1.4]} camera={{ position: [offsetX, 2.4, 6.2], fov: 30 }}
      gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
      style={{ position: "absolute", inset: 0 }}
    >
      <color attach="background" args={["#0b0a09"]} />
      <fog attach="fog" args={["#0b0a09", 6, 15]} />
      <ambientLight intensity={0.08} />
      <Rig pointer={pointer} x={offsetX} compact={compact} />
      <pointLight position={[2.5, 1.6, -2]} intensity={6} color="#b78a5a" />
      {/* studio reflections without downloading an HDR: soft light panels */}
      <Environment resolution={high ? 256 : 128}>
        <Lightformer intensity={3.2} position={[-3, 3, 2]} scale={[4, 1.2, 1]} color="#fff1dd" />
        <Lightformer intensity={1.6} position={[0, 2, 5]} scale={[6, 2, 1]} color="#fff6ec" />
        <Lightformer intensity={0.8} position={[3, 1.5, -2]} scale={[3, 2, 1]} color="#b78a5a" />
        <Lightformer form="ring" intensity={1.2} position={[0, 4, -1]} scale={2} color="#ffffff" />
      </Environment>
      <group position={[0, 0, 0]}>
        <Table quality={quality} />
        <Cup pointer={pointer} />
        <Steam count={high ? 4 : 2} />
        <ContactShadows position={[0, 0.001, 0]} opacity={0.65} scale={4} blur={2.6} far={1.2} color="#000" />
      </group>
      <Bokeh count={high ? 26 : 12} />
    </Canvas>
  );
}
