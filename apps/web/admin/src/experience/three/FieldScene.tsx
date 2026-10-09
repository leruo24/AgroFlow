import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { buildHardwareModel } from "@/features/hardwareModel";
import type { CameraMode, ViewMode } from "../engine/demoReducer";

interface FieldSceneProps {
  pumpRunning: boolean;
  relayOn: boolean;
  controllerActive: boolean;
  progress: number;
  moisture: number;
  cameraMode: CameraMode;
  viewMode: ViewMode;
  rainExpected: boolean;
  reducedMotion: boolean;
}

const CAMERA: Record<CameraMode, { position: [number, number, number]; target: [number, number, number] }> = {
  FIELD_OVERVIEW: { position: [10.5, 7.8, 12], target: [0, 0, -1] },
  RECOMMENDATION: { position: [9.4, 6.8, 10.8], target: [-0.7, 0.3, -1] },
  CONTROLLER_FOCUS: { position: [-1.2, 4.2, 7], target: [-3.6, 1.7, -1.3] },
  IRRIGATION_RUNNING: { position: [7.8, 5.6, 9.2], target: [0.4, 0.2, -1.6] },
  FIELD_RESULT: { position: [11.4, 8.4, 13.2], target: [0, 0, -1.2] },
  WEATHER_EVENT: { position: [12.2, 9.2, 14.2], target: [0, 1, -2.5] },
};

function CameraRig({ mode, reducedMotion }: { mode: CameraMode; reducedMotion: boolean }) {
  const { camera, size } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    const destination = CAMERA[mode];
    const alpha = reducedMotion ? 1 : 1 - Math.exp(-delta * 1.9);
    const mobile = size.width < 680;
    const position = mobile
      ? new THREE.Vector3(destination.position[0] * 0.72, destination.position[1] + 1, destination.position[2] + 6)
      : new THREE.Vector3(...destination.position);
    const lookAt = mobile
      ? new THREE.Vector3(destination.target[0] - 1.25, destination.target[1], destination.target[2])
      : new THREE.Vector3(...destination.target);
    camera.position.lerp(position, alpha);
    target.lerp(lookAt, alpha);
    camera.lookAt(target);
  });
  return null;
}

function CropRows({ moisture }: { moisture: number }) {
  const leaves = useRef<THREE.InstancedMesh>(null);
  const upperLeaves = useRef<THREE.InstancedMesh>(null);
  const stems = useRef<THREE.InstancedMesh>(null);
  const count = 56;
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let index = 0; index < count; index += 1) {
      const row = index % 4;
      const column = Math.floor(index / 4);
      const x = -1.5 + row * 2.05;
      const z = 4.7 - column * 0.73;
      const sway = Math.sin(index * 1.71) * 0.08;
      position.set(x + sway, 0.54, z);
      scale.set(0.42, 0.58 + (index % 3) * 0.05, 0.42);
      matrix.compose(position, rotation, scale);
      leaves.current?.setMatrixAt(index, matrix);
      position.set(x - sway * 0.5, 0.82, z + 0.03);
      rotation.setFromEuler(new THREE.Euler(0, index * 0.71, 0.18 * Math.sin(index)));
      scale.set(0.32, 0.38 + (index % 2) * 0.05, 0.35);
      matrix.compose(position, rotation, scale);
      upperLeaves.current?.setMatrixAt(index, matrix);
      position.y = 0.23;
      rotation.identity();
      scale.set(0.07, 0.48, 0.07);
      matrix.compose(position, rotation, scale);
      stems.current?.setMatrixAt(index, matrix);
    }
    if (leaves.current) leaves.current.instanceMatrix.needsUpdate = true;
    if (upperLeaves.current) upperLeaves.current.instanceMatrix.needsUpdate = true;
    if (stems.current) stems.current.instanceMatrix.needsUpdate = true;
  }, []);
  const green = moisture > 56 ? "#397f45" : "#4f813e";
  return (
    <group>
      <instancedMesh ref={stems} args={[undefined, undefined, count]} castShadow>
        <cylinderGeometry args={[1, 1, 1, 5]} />
        <meshStandardMaterial color="#315f33" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={leaves} args={[undefined, undefined, count]} castShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={green} roughness={0.84} />
      </instancedMesh>
      <instancedMesh ref={upperLeaves} args={[undefined, undefined, count]} castShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={moisture > 56 ? "#4b9552" : "#5b9147"} roughness={0.88} />
      </instancedMesh>
    </group>
  );
}

function Soil({ progress }: { progress: number }) {
  const clods = useRef<THREE.InstancedMesh>(null);
  const clodCount = 72;
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let index = 0; index < clodCount; index += 1) {
      const x = (((index * 37) % 101) / 100) * 20 - 10;
      const z = (((index * 61) % 97) / 96) * 17 - 8.5;
      position.set(x, 0.045, z);
      rotation.setFromEuler(new THREE.Euler(index * 0.31, index * 0.73, 0));
      const size = 0.055 + (index % 5) * 0.014;
      scale.set(size * 1.4, size * 0.55, size);
      matrix.compose(position, rotation, scale);
      clods.current?.setMatrixAt(index, matrix);
    }
    if (clods.current) clods.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[22, 19]} />
        <meshStandardMaterial color="#765039" roughness={1} />
      </mesh>
      {[0, 1, 2, 3].map((row) => (
        <group key={row}>
          <mesh position={[-1.5 + row * 2.05, 0.12, -0.1]} scale={[1.25, 0.22, 8.4]} receiveShadow>
            <boxGeometry />
            <meshStandardMaterial color="#83583d" roughness={1} />
          </mesh>
          <mesh
            position={[-1.5 + row * 2.05, 0.235, 4.4 - progress * 4.2]}
            scale={[1.08, 0.025, Math.max(0.08, progress * 8.1)]}
          >
            <boxGeometry />
            <meshStandardMaterial color="#3e3028" transparent opacity={0.28 + progress * 0.66} roughness={1} />
          </mesh>
        </group>
      ))}
      <instancedMesh ref={clods} args={[undefined, undefined, clodCount]} receiveShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#5f3f2e" roughness={1} />
      </instancedMesh>
    </group>
  );
}

function IrrigationSystem({ running }: { running: boolean }) {
  const droplets = useRef<THREE.InstancedMesh>(null);
  const risers = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const sprayMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const dropCount = 120;
  const emitterCount = 12;
  const temp = useMemo(() => new THREE.Object3D(), []);
  const flow = useRef(0);
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let index = 0; index < emitterCount; index += 1) {
      const row = Math.floor(index / 3);
      const station = index % 3;
      const x = -1.5 + row * 2.05;
      const z = 3.15 - station * 3.05;
      position.set(x, 0.55, z);
      scale.set(0.025, 0.36, 0.025);
      matrix.compose(position, rotation, scale);
      risers.current?.setMatrixAt(index, matrix);
      position.y = 0.91;
      scale.set(0.11, 0.04, 0.11);
      matrix.compose(position, rotation, scale);
      heads.current?.setMatrixAt(index, matrix);
    }
    if (risers.current) risers.current.instanceMatrix.needsUpdate = true;
    if (heads.current) heads.current.instanceMatrix.needsUpdate = true;
  }, []);
  useFrame(({ clock }, delta) => {
    flow.current = THREE.MathUtils.damp(flow.current, running ? 1 : 0, 5.2, delta);
    if (!droplets.current) return;
    for (let index = 0; index < dropCount; index += 1) {
      const emitter = index % emitterCount;
      const stream = Math.floor(index / emitterCount);
      const row = Math.floor(emitter / 3);
      const station = emitter % 3;
      const phase = (clock.elapsedTime * 0.72 + stream / 10) % 1;
      const direction = stream % 2 === 0 ? -1 : 1;
      const x = -1.5 + row * 2.05 + direction * phase * 0.68;
      const z = 3.15 - station * 3.05 + (stream - 2.5) * 0.035;
      const y = 0.91 + Math.sin(phase * Math.PI) * 0.44 - phase * 0.18;
      temp.position.set(x, y, z);
      temp.scale.setScalar((0.032 + (index % 3) * 0.006) * flow.current);
      temp.updateMatrix();
      droplets.current.setMatrixAt(index, temp.matrix);
    }
    droplets.current.instanceMatrix.needsUpdate = true;
    if (sprayMaterial.current) sprayMaterial.current.opacity = 0.76 * flow.current;
  });
  return (
    <group>
      {[-1.5, 0.55, 2.6, 4.65].map((x) => (
        <mesh key={x} position={[x, 0.36, -0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 9.1, 8]} />
          <meshStandardMaterial color={running ? "#2b7181" : "#242a29"} roughness={0.55} />
        </mesh>
      ))}
      <mesh position={[1.55, 0.38, 4.6]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.08, 0.08, 6.5, 10]} />
        <meshStandardMaterial color="#252c2c" />
      </mesh>
      <instancedMesh ref={risers} args={[undefined, undefined, emitterCount]} castShadow>
        <cylinderGeometry args={[1, 1, 1, 7]} />
        <meshStandardMaterial color="#343d3b" metalness={0.18} roughness={0.62} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, emitterCount]} castShadow>
        <cylinderGeometry args={[1, 1, 1, 10]} />
        <meshStandardMaterial color={running ? "#2f8d93" : "#465350"} metalness={0.12} roughness={0.54} />
      </instancedMesh>
      <instancedMesh ref={droplets} args={[undefined, undefined, dropCount]}>
        <sphereGeometry args={[1, 7, 5]} />
        <meshStandardMaterial ref={sprayMaterial} color="#8bd7e2" transparent opacity={0} roughness={0.16} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

function PumpUnit({ running }: { running: boolean }) {
  const unit = useRef<THREE.Group>(null);
  const status = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }, delta) => {
    if (unit.current) {
      const vibration = running ? Math.sin(clock.elapsedTime * 42) * 0.007 : 0;
      unit.current.position.y = THREE.MathUtils.damp(unit.current.position.y, 0.54 + vibration, 10, delta);
      unit.current.rotation.z = THREE.MathUtils.damp(unit.current.rotation.z, running ? Math.sin(clock.elapsedTime * 35) * 0.004 : 0, 9, delta);
    }
    if (status.current) status.current.emissiveIntensity = THREE.MathUtils.damp(status.current.emissiveIntensity, running ? 2.2 : 0.35, 6, delta);
  });
  return (
    <group>
      <mesh position={[-2.72, 0.34, 2.9]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.075, 0.075, 3.4, 10]} />
        <meshStandardMaterial color="#252d2c" roughness={0.55} />
      </mesh>
      <group ref={unit} position={[-2.72, 0.54, 1.2]} rotation={[0, 0.05, 0]} scale={0.82}>
        <mesh position={[0, -0.3, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.25, 0.18, 0.78]} />
          <meshStandardMaterial color="#3b4846" metalness={0.35} roughness={0.48} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.86, 14]} />
          <meshStandardMaterial color="#315f63" metalness={0.38} roughness={0.38} />
        </mesh>
        <mesh position={[0.54, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.31, 0.36, 0.28, 14]} />
          <meshStandardMaterial color="#263635" metalness={0.42} roughness={0.35} />
        </mesh>
        <mesh position={[-0.51, 0.03, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.17, 0.17, 0.24, 10]} />
          <meshStandardMaterial color="#1f2929" />
        </mesh>
        <mesh position={[0.07, 0.43, 0]} castShadow>
          <boxGeometry args={[0.44, 0.25, 0.46]} />
          <meshStandardMaterial color="#263b3b" roughness={0.46} />
        </mesh>
        <mesh position={[0.22, 0.48, 0.24]}>
          <sphereGeometry args={[0.055, 10, 7]} />
          <meshStandardMaterial ref={status} color={running ? "#74d97c" : "#4e8e70"} emissive={running ? "#2aba46" : "#174e38"} emissiveIntensity={0.35} />
        </mesh>
      </group>
    </group>
  );
}

function Controller({ active, relayOn }: { active: boolean; relayOn: boolean }) {
  const model = useMemo(() => buildHardwareModel(THREE), []);
  useEffect(() => {
    model.lid.rotation.y = -0.18;
    return () => {
      const materials = new Set<THREE.Material>();
      model.root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => materials.add(material));
        else if (mesh.material) materials.add(mesh.material);
      });
      model.textures.forEach((texture) => texture.dispose());
      materials.forEach((material) => material.dispose());
    };
  }, [model]);
  return (
    <group position={[-3.45, 2.25, -1.2]} scale={0.44} rotation={[0, 0.18, 0]}>
      <primitive object={model.root} />
      <mesh position={[1.75, 2.2, 1.36]}>
        <sphereGeometry args={[0.11, 12, 8]} />
        <meshStandardMaterial color={active ? "#79d87c" : "#68bfa9"} emissive={active ? "#2ebc46" : "#176f61"} emissiveIntensity={active ? 2.2 : 0.5} />
      </mesh>
      <mesh position={[0.15, -0.35, 1.45]} visible={relayOn}>
        <boxGeometry args={[1.1, 0.08, 0.06]} />
        <meshBasicMaterial color="#efb244" />
      </mesh>
    </group>
  );
}

function RootZone({ progress, moisture }: { progress: number; moisture: number }) {
  return (
    <group position={[0, 0.15, -0.8]}>
      <mesh position={[0, -0.75, 0]}>
        <boxGeometry args={[10.5, 2.3, 4.2]} />
        <meshStandardMaterial color="#6d4934" roughness={1} transparent opacity={0.96} />
      </mesh>
      <mesh position={[0, -0.48, 0.05]} scale={[4.6, 0.72 + progress * 0.48, 1.7]}>
        <sphereGeometry args={[1, 24, 12]} />
        <meshStandardMaterial color="#335e72" transparent opacity={0.16 + progress * 0.27} />
      </mesh>
      {[-3, -1, 1, 3].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 0.65, 0]}>
            <coneGeometry args={[0.48, 1.25, 6]} />
            <meshStandardMaterial color="#4f813e" />
          </mesh>
          {[-0.32, 0, 0.32].map((offset) => (
            <mesh key={offset} position={[offset * 0.5, -0.52, 0]} rotation={[0, 0, offset]}>
              <cylinderGeometry args={[0.018, 0.045, 1.55, 6]} />
              <meshStandardMaterial color="#d5b484" />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={[-4.25, -0.55, 0.15]} rotation={[0, 0, -0.08]}>
        <boxGeometry args={[0.12, 1.75, 0.24]} />
        <meshStandardMaterial color="#b58b39" metalness={0.55} roughness={0.42} />
      </mesh>
      <mesh position={[0, 0.08, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, 9.2, 8]} />
        <meshStandardMaterial color="#262d2c" />
      </mesh>
      <mesh position={[0, 1.75, -1.4]}>
        <planeGeometry args={[4.2, 0.8]} />
        <meshBasicMaterial color="#f4f0e6" transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 1.74, -1.35]}>
        <planeGeometry args={[Math.max(0.2, moisture / 24), 0.18]} />
        <meshBasicMaterial color="#168f99" />
      </mesh>
    </group>
  );
}

function Landscape({ rainExpected }: { rainExpected: boolean }) {
  return (
    <fog attach="fog" args={[rainExpected ? "#9aa9a6" : "#c9d9ce", 14, 30]} />
  );
}

function SceneContent(props: FieldSceneProps) {
  return (
    <>
      <ambientLight intensity={1.1} />
      <hemisphereLight args={[props.rainExpected ? "#c3d2d3" : "#e9f4ff", "#5a3c2e", 1.25]} />
      <directionalLight position={[-5, 9, 7]} intensity={2.7} color={props.rainExpected ? "#d7e0db" : "#fff1d3"} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <CameraRig mode={props.cameraMode} reducedMotion={props.reducedMotion} />
      {props.viewMode === "FIELD" ? (
        <>
          <Soil progress={props.progress} />
          <CropRows moisture={props.moisture} />
          <IrrigationSystem running={props.pumpRunning} />
          <PumpUnit running={props.pumpRunning} />
          <Controller active={props.controllerActive} relayOn={props.relayOn} />
          <Landscape rainExpected={props.rainExpected} />
        </>
      ) : (
        <RootZone progress={props.progress} moisture={props.moisture} />
      )}
      <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={0.75} maxPolarAngle={1.32} minAzimuthAngle={-0.45} maxAzimuthAngle={0.45} rotateSpeed={0.35} />
    </>
  );
}

export function FieldScene(props: FieldSceneProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ fov: 38, near: 0.1, far: 80, position: CAMERA.FIELD_OVERVIEW.position }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      aria-label={props.viewMode === "FIELD" ? "Interactive 3D view of North Field and the AgroFlow controller" : "Simplified root-zone moisture visualisation"}
    >
      <SceneContent {...props} />
    </Canvas>
  );
}
