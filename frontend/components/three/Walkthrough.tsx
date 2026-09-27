"use client";
import { useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { CameraControls, ContactShadows, Environment, Html, Lightformer, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { SPACES } from "@/lib/content";

// A cut-away architectural model of the café: cream walls, walnut, bronze and stone on a dark ground.
const C = { stone: "#cbbda9", wall: "#efe7da", walnut: "#5a3a26", bronze: "#b78a5a", cushion: "#6d6a4d", green: "#4b5a3a", glass: "#dfe8e4" };

export const VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [11, 11, 13], target: [0, 0, 0] },
  bar: { pos: [-1.5, 3.2, 3.8], target: [-3.2, 0.8, -2.6] },
  private: { pos: [2.2, 3.6, -0.2], target: [5.2, 0.6, -2.6] },
  outdoor: { pos: [3.5, 3.4, 9.5], target: [3, 0.4, 5.2] },
  bakery: { pos: [-2.6, 2.6, 2.6], target: [-5.4, 0.8, 1.2] },
  lounge: { pos: [-0.8, 3, 7.4], target: [-3.6, 0.5, 4.2] },
};
const HOTSPOTS: Record<string, [number, number, number]> = {
  bar: [-3.2, 2.1, -2.6], private: [5.2, 2.2, -2.6], outdoor: [3.2, 1.8, 5.4], bakery: [-5.4, 1.9, 1.2], lounge: [-3.6, 1.6, 4.2],
};

/** Back wall with a row of pointed (Qutb Shahi) arched windows, glowing warm from outside. */
function ArchWall({ width, height, arches, position, rotation = [0, 0, 0] }:
  { width: number; height: number; arches: number; position: [number, number, number]; rotation?: [number, number, number] }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape(); s.moveTo(-width / 2, 0); s.lineTo(width / 2, 0); s.lineTo(width / 2, height); s.lineTo(-width / 2, height); s.closePath();
    const step = width / arches, w = step * 0.5, spring = height * 0.55, peak = height * 0.82;
    for (let i = 0; i < arches; i++) {
      const cx = -width / 2 + step * (i + .5), h = new THREE.Path();
      h.moveTo(cx - w / 2, 0.35); h.lineTo(cx - w / 2, spring);
      h.bezierCurveTo(cx - w / 2, spring + (peak - spring) * .6, cx - w * .1, peak - .05, cx, peak);
      h.bezierCurveTo(cx + w * .1, peak - .05, cx + w / 2, spring + (peak - spring) * .6, cx + w / 2, spring);
      h.lineTo(cx + w / 2, 0.35); h.closePath(); s.holes.push(h);
    }
    return new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: false });
  }, [width, height, arches]);
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={geo} castShadow receiveShadow><meshStandardMaterial color={C.wall} roughness={0.9} /></mesh>
      {/* warm light beyond the windows */}
      <mesh position={[0, height * 0.5, -0.4]}><planeGeometry args={[width, height]} /><meshBasicMaterial color="#f3c58e" toneMapped={false} /></mesh>
    </group>
  );
}

function Chair({ p, r = 0 }: { p: [number, number, number]; r?: number }) {
  return (
    <group position={p} rotation={[0, r, 0]}>
      <RoundedBox args={[0.42, 0.06, 0.42]} radius={0.02} position={[0, 0.45, 0]} castShadow><meshStandardMaterial color={C.walnut} roughness={0.6} /></RoundedBox>
      <RoundedBox args={[0.42, 0.45, 0.05]} radius={0.02} position={[0, 0.7, -0.19]} castShadow><meshStandardMaterial color={C.walnut} roughness={0.6} /></RoundedBox>
      {[[-.17, -.17], [.17, -.17], [-.17, .17], [.17, .17]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.22, z]}><cylinderGeometry args={[0.018, 0.018, 0.45]} /><meshStandardMaterial color={C.bronze} metalness={0.7} roughness={0.35} /></mesh>))}
    </group>
  );
}
function Table({ p, round = true, size = 0.8 }: { p: [number, number, number]; round?: boolean; size?: number }) {
  return (
    <group position={p}>
      {round ? <mesh position={[0, 0.74, 0]} castShadow receiveShadow><cylinderGeometry args={[size / 2, size / 2, 0.04, 40]} /><meshStandardMaterial color="#e9e2d6" roughness={0.25} metalness={0.05} /></mesh>
             : <RoundedBox args={[size, 0.05, 0.9]} radius={0.02} position={[0, 0.74, 0]} castShadow receiveShadow><meshStandardMaterial color={C.walnut} roughness={0.5} /></RoundedBox>}
      <mesh position={[0, 0.37, 0]}><cylinderGeometry args={[0.03, 0.05, 0.74]} /><meshStandardMaterial color={C.bronze} metalness={0.7} roughness={0.35} /></mesh>
    </group>
  );
}
function Pendant({ p }: { p: [number, number, number] }) {
  return (
    <group position={p}>
      <mesh position={[0, 0.6, 0]}><cylinderGeometry args={[0.005, 0.005, 1.2]} /><meshBasicMaterial color="#222" /></mesh>
      <mesh><sphereGeometry args={[0.13, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={C.bronze} metalness={0.8} roughness={0.3} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, -0.02, 0]}><sphereGeometry args={[0.06, 16, 12]} /><meshBasicMaterial color="#ffd9a6" toneMapped={false} /></mesh>
      <pointLight position={[0, -0.2, 0]} intensity={1.6} distance={3} color="#ffcf98" />
    </group>
  );
}
function Tree({ p, s = 1 }: { p: [number, number, number]; s?: number }) {
  return (
    <group position={p} scale={s}>
      <mesh position={[0, 0.2, 0]} castShadow><cylinderGeometry args={[0.35, 0.3, 0.4, 24]} /><meshStandardMaterial color={C.stone} roughness={0.9} /></mesh>
      <mesh position={[0, 0.9, 0]}><cylinderGeometry args={[0.05, 0.07, 1.2]} /><meshStandardMaterial color="#4a3526" /></mesh>
      <mesh position={[0, 1.7, 0]} castShadow><icosahedronGeometry args={[0.75, 1]} /><meshStandardMaterial color={C.green} roughness={0.95} flatShading /></mesh>
    </group>
  );
}

function Cafe() {
  return (
    <group>
      {/* floors: indoor stone, outdoor courtyard */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, -0.5]}><planeGeometry args={[14, 9]} /><meshStandardMaterial color={C.stone} roughness={0.85} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 5.8]}><planeGeometry args={[14, 3.6]} /><meshStandardMaterial color="#a89780" roughness={1} /></mesh>
      {/* walls: arched back wall, side wall, private-room partition */}
      <ArchWall width={14} height={3.6} arches={6} position={[0, 0, -5]} />
      <ArchWall width={9} height={3.6} arches={4} position={[-7, 0, -0.5]} rotation={[0, Math.PI / 2, 0]} />
      <mesh position={[2.9, 1.5, -2.2]} castShadow receiveShadow><boxGeometry args={[0.15, 3, 5.6]} /><meshStandardMaterial color={C.wall} roughness={0.9} /></mesh>

      {/* coffee bar: walnut counter, espresso machine, stools, pendants */}
      <group position={[-3.2, 0, -3.2]}>
        <RoundedBox args={[4.2, 1.05, 0.8]} radius={0.04} position={[0, 0.52, 0]} castShadow receiveShadow><meshStandardMaterial color={C.walnut} roughness={0.55} /></RoundedBox>
        <RoundedBox args={[4.3, 0.05, 0.9]} radius={0.02} position={[0, 1.07, 0]}><meshStandardMaterial color="#1c1b19" roughness={0.2} /></RoundedBox>
        <RoundedBox args={[0.9, 0.5, 0.5]} radius={0.05} position={[-0.6, 1.35, -0.1]} castShadow><meshStandardMaterial color="#d9d6cf" metalness={0.9} roughness={0.2} /></RoundedBox>
        <mesh position={[0.9, 1.3, -0.1]} castShadow><cylinderGeometry args={[0.18, 0.2, 0.42, 24]} /><meshStandardMaterial color={C.bronze} metalness={0.85} roughness={0.25} /></mesh>
        {[-1.5, -0.5, 0.5, 1.5].map((x) => <group key={x} position={[x, 0, 0.8]}><mesh position={[0, 0.72, 0]} castShadow><cylinderGeometry args={[0.2, 0.2, 0.06, 24]} /><meshStandardMaterial color={C.cushion} /></mesh><mesh position={[0, 0.36, 0]}><cylinderGeometry args={[0.025, 0.025, 0.72]} /><meshStandardMaterial color={C.bronze} metalness={0.7} roughness={0.35} /></mesh></group>)}
        {[-1.4, 0, 1.4].map((x) => <Pendant key={x} p={[x, 2.4, 0]} />)}
      </group>

      {/* bakery: glass display case with pastries */}
      <group position={[-5.4, 0, 1.2]}>
        <RoundedBox args={[0.9, 0.85, 2.4]} radius={0.03} position={[0, 0.43, 0]} castShadow><meshStandardMaterial color={C.walnut} roughness={0.55} /></RoundedBox>
        <mesh position={[0, 1.12, 0]}><boxGeometry args={[0.85, 0.5, 2.3]} /><meshPhysicalMaterial color={C.glass} transparent opacity={0.25} roughness={0.05} /></mesh>
        {Array.from({ length: 10 }, (_, i) => <mesh key={i} position={[(i % 2 - .5) * .35, 0.95, -1 + Math.floor(i / 2) * .5]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.1, 0.05, 10, 20]} /><meshStandardMaterial color="#c98a4a" roughness={0.7} /></mesh>)}
      </group>

      {/* main floor tables */}
      {[[-0.6, 0, 0.2], [1.2, 0, 1.6], [-1.8, 0, 1.4]].map((p, i) => (
        <group key={i}><Table p={p as [number, number, number]} />
          <Chair p={[p[0] - 0.62, 0, p[2]]} r={Math.PI / 2} /><Chair p={[p[0] + 0.62, 0, p[2]]} r={-Math.PI / 2} /></group>))}

      {/* private dining: long table for ten behind the partition */}
      <group position={[5.2, 0, -2.6]}>
        <Table p={[0, 0, 0]} round={false} size={3} />
        {[-1.1, -0.35, 0.4, 1.15].map((x) => <group key={x}><Chair p={[x, 0, -0.75]} /><Chair p={[x, 0, 0.75]} r={Math.PI} /></group>)}
        {[-0.8, 0.8].map((x) => <Pendant key={x} p={[x, 2.3, 0]} />)}
      </group>

      {/* work lounge: two sofas and a low table */}
      <group position={[-3.6, 0, 4.1]}>
        {[-0.9, 0.9].map((z) => (
          <group key={z} position={[0, 0, z]} rotation={[0, z > 0 ? Math.PI : 0, 0]}>
            <RoundedBox args={[2, 0.45, 0.8]} radius={0.12} position={[0, 0.25, 0]} castShadow><meshStandardMaterial color={C.cushion} roughness={0.95} /></RoundedBox>
            <RoundedBox args={[2, 0.5, 0.2]} radius={0.1} position={[0, 0.6, -0.33]} castShadow><meshStandardMaterial color={C.cushion} roughness={0.95} /></RoundedBox>
          </group>))}
        <RoundedBox args={[1.1, 0.3, 0.6]} radius={0.04} position={[0, 0.15, 0]} castShadow><meshStandardMaterial color={C.walnut} /></RoundedBox>
      </group>

      {/* courtyard: neem trees, lanterns, bistro tables */}
      <Tree p={[0.6, 0, 7]} s={1.1} /><Tree p={[6, 0, 6.4]} />
      {[[2.4, 0, 5.2], [4.4, 0, 5.8]].map((p, i) => <group key={i}><Table p={p as [number, number, number]} size={0.7} /><Chair p={[p[0] - 0.55, 0, p[2]]} r={Math.PI / 2} /><Chair p={[p[0] + 0.55, 0, p[2]]} r={-Math.PI / 2} /></group>)}
    </group>
  );
}

function Hotspot({ id, active, onSelect }: { id: string; active: string; onSelect: (id: string) => void }) {
  const space = SPACES.find((s) => s.id === id)!;
  return (
    <Html position={HOTSPOTS[id]} center distanceFactor={11} zIndexRange={[20, 0]}>
      <button onClick={() => onSelect(id)} aria-label={`View ${space.title}`}
        className={`group flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] backdrop-blur transition-all duration-500
          ${active === id ? "border-cream bg-cream text-ink" : "border-cream/40 bg-ink/70 text-ivory hover:bg-cream hover:text-ink"}`}>
        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bronze-2 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-bronze-2" /></span>
        {space.title}
      </button>
    </Html>
  );
}

export default function Walkthrough({ active, onSelect, quality }: { active: string; onSelect: (id: string) => void; quality: "high" | "low" }) {
  const controls = useRef<CameraControls>(null);
  useEffect(() => {
    const v = VIEWS[active] ?? VIEWS.overview;
    controls.current?.setLookAt(...v.pos, ...v.target, true);
  }, [active]);
  const high = quality === "high";
  return (
    <Canvas shadows={high ? "percentage" : false} dpr={high ? [1, 2] : [1, 1.4]} camera={{ position: VIEWS.overview.pos, fov: 35 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}>
      <color attach="background" args={["#11100e"]} />
      <fog attach="fog" args={["#11100e", 22, 40]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[8, 14, 6]} intensity={1.6} color="#fff0dc" castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-bias={-0.0005} />
      <Environment resolution={128}>
        <Lightformer intensity={1.5} position={[5, 8, 5]} scale={[10, 10, 1]} color="#fff4e6" />
        <Lightformer intensity={0.6} position={[-6, 3, -4]} scale={[6, 4, 1]} color="#b78a5a" />
      </Environment>
      <Cafe />
      <ContactShadows position={[0, 0.005, 0]} opacity={0.35} scale={30} blur={2.4} far={4} />
      {Object.keys(HOTSPOTS).map((id) => <Hotspot key={id} id={id} active={active} onSelect={onSelect} />)}
      <CameraControls ref={controls} minDistance={3} maxDistance={24} minPolarAngle={0.25} maxPolarAngle={1.35}
        truckSpeed={0} dollySpeed={0.6} smoothTime={0.6} />
    </Canvas>
  );
}
