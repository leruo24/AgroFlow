import type {
  BufferGeometry,
  CatmullRomCurve3,
  Group,
  Material,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";

type ThreeModule = typeof import("three");

export type ComponentKey = "esp32" | "soil" | "dht" | "relay" | "pump" | "power";

export interface HardwareModel {
  root: Group;
  /** Pivoted at the left-hand hinge; rotating Y opens the enclosure like a door. */
  lid: Group;
  anchors: Record<ComponentKey, Object3D>;
  /** Alternate label targets used after the door opens. */
  openAnchors: Partial<Record<ComponentKey, Object3D>>;
  componentMaterials: Record<ComponentKey, Material[]>;
  sensePath: CatmullRomCurve3;
  actPath: CatmullRomCurve3;
  senseSignal: Group;
  actSignal: Group;
  sensePulse: Mesh;
  actPulse: Mesh;
  waterDrops: Mesh[];
  textures: Texture[];
}

export interface HardwareScene {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  model: HardwareModel;
}

function roundedShape(THREE: ThreeModule, width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function roundedPanelGeometry(
  THREE: ThreeModule,
  width: number,
  height: number,
  depth: number,
  radius: number,
  bevel = 0.08,
): BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(roundedShape(THREE, width, height, radius), {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: Math.min(radius * 0.26, bevel),
    bevelThickness: Math.min(depth * 0.16, bevel * 0.75),
    curveSegments: 8,
  });
  geometry.center();
  return geometry;
}

function roundedFrameGeometry(
  THREE: ThreeModule,
  width: number,
  height: number,
  inset: number,
  depth: number,
  radius: number,
): BufferGeometry {
  const shape = roundedShape(THREE, width, height, radius);
  const hole = new THREE.Path();
  const innerWidth = width - inset * 2;
  const innerHeight = height - inset * 2;
  const innerRadius = Math.max(0.06, radius - inset * 0.45);
  const x = -innerWidth / 2;
  const y = -innerHeight / 2;
  // Reverse winding keeps the centre hollow in ExtrudeGeometry.
  hole.moveTo(x + innerRadius, y);
  hole.lineTo(x + innerRadius, y + innerHeight);
  hole.quadraticCurveTo(x, y + innerHeight, x, y + innerHeight - innerRadius);
  hole.lineTo(x, y + innerRadius);
  hole.quadraticCurveTo(x, y, x + innerRadius, y);
  hole.lineTo(x + innerWidth - innerRadius, y);
  hole.quadraticCurveTo(x + innerWidth, y, x + innerWidth, y + innerRadius);
  hole.lineTo(x + innerWidth, y + innerHeight - innerRadius);
  hole.quadraticCurveTo(x + innerWidth, y + innerHeight, x + innerWidth - innerRadius, y + innerHeight);
  hole.lineTo(x + innerRadius, y + innerHeight);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.025,
    bevelThickness: 0.02,
    curveSegments: 8,
  });
  geometry.center();
  return geometry;
}

function addBox(
  THREE: ThreeModule,
  parent: Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: Material,
): Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function addRoundedPanel(
  THREE: ThreeModule,
  parent: Object3D,
  size: [number, number, number],
  position: [number, number, number],
  radius: number,
  material: Material,
): Mesh {
  const mesh = new THREE.Mesh(roundedPanelGeometry(THREE, size[0], size[1], size[2], radius, Math.min(0.035, radius * 0.45)), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  THREE: ThreeModule,
  parent: Object3D,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  position: [number, number, number],
  material: Material,
  radialSegments = 16,
): Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments), material);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function addCable(
  THREE: ThreeModule,
  parent: Object3D,
  points: Vector3[],
  material: Material,
  radius = 0.04,
  tubularSegments = 36,
): Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, tubularSegments, radius, 8, false), material);
  parent.add(cable);
  return cable;
}

function addAnchor(THREE: ThreeModule, parent: Object3D, position: [number, number, number]): Object3D {
  const anchor = new THREE.Object3D();
  anchor.position.set(...position);
  parent.add(anchor);
  return anchor;
}

function addScrew(
  THREE: ThreeModule,
  parent: Object3D,
  position: [number, number, number],
  metal: Material,
  slot: Material,
  scale = 1,
): void {
  const head = addCylinder(THREE, parent, 0.105 * scale, 0.105 * scale, 0.055 * scale, position, metal, 20);
  head.rotation.x = Math.PI / 2;
  addBox(THREE, parent, [0.13 * scale, 0.018 * scale, 0.016], [position[0], position[1], position[2] + 0.034], slot);
  addBox(THREE, parent, [0.018 * scale, 0.13 * scale, 0.016], [position[0], position[1], position[2] + 0.035], slot);
}

function addScrewRecess(
  THREE: ThreeModule,
  parent: Object3D,
  position: [number, number, number],
  recess: Material,
  metal: Material,
  slot: Material,
  scale = 1,
): void {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.145 * scale, 0.035 * scale, 8, 22), recess);
  ring.position.set(position[0], position[1], position[2] - 0.018);
  parent.add(ring);
  addScrew(THREE, parent, position, metal, slot, scale);
}

function addPcbHole(
  THREE: ThreeModule,
  parent: Object3D,
  position: [number, number, number],
  copper: Material,
  voidMaterial: Material,
  scale = 1,
): void {
  const pad = new THREE.Mesh(new THREE.TorusGeometry(0.065 * scale, 0.018 * scale, 7, 18), copper);
  pad.position.set(...position);
  parent.add(pad);
  const hole = addCylinder(THREE, parent, 0.040 * scale, 0.040 * scale, 0.018, [position[0], position[1], position[2] - 0.004], voidMaterial, 14);
  hole.rotation.x = Math.PI / 2;
}

function addStandoffs(
  THREE: ThreeModule,
  parent: Object3D,
  halfWidth: number,
  halfHeight: number,
  z: number,
  metal: Material,
  screw: Material,
): void {
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [-halfHeight, halfHeight]) {
      const post = addCylinder(THREE, parent, 0.07, 0.07, 0.14, [x, y, z], metal, 12);
      post.rotation.x = Math.PI / 2;
      const head = addCylinder(THREE, parent, 0.045, 0.045, 0.025, [x, y, z + 0.085], screw, 12);
      head.rotation.x = Math.PI / 2;
    }
  }
}

function addGland(
  THREE: ThreeModule,
  parent: Object3D,
  x: number,
  bodyMaterial: Material,
  ringMaterial: Material,
): Group {
  const gland = new THREE.Group();
  gland.position.set(x, -2.18, 0.23);
  parent.add(gland);
  const nut = addCylinder(THREE, gland, 0.25, 0.25, 0.17, [0, 0.15, 0], ringMaterial, 6);
  const body = addCylinder(THREE, gland, 0.19, 0.22, 0.32, [0, -0.08, 0], bodyMaterial, 18);
  const cap = addCylinder(THREE, gland, 0.155, 0.19, 0.18, [0, -0.30, 0], bodyMaterial, 18);
  nut.castShadow = body.castShadow = true;
  cap.castShadow = true;
  for (const y of [-0.365, -0.325, -0.285, -0.245]) {
    addCylinder(THREE, gland, 0.168, 0.168, 0.018, [0, y, 0], ringMaterial, 18);
  }
  return gland;
}

function makeSurfaceTexture(THREE: ThreeModule): Texture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const pixels = context.createImageData(canvas.width, canvas.height);
  let seed = 1947;
  for (let index = 0; index < pixels.data.length; index += 4) {
    seed = (seed * 16807) % 2147483647;
    const variation = 125 + Math.round((seed / 2147483647) * 18);
    pixels.data[index] = variation;
    pixels.data[index + 1] = variation;
    pixels.data[index + 2] = variation;
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.needsUpdate = true;
  return texture;
}

function makeBrandTexture(THREE: ThreeModule): Texture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 220;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#184d35";
  context.save();
  context.translate(320, 48);
  context.rotate(-0.48);
  context.beginPath();
  context.ellipse(-12, 0, 15, 30, 0, 0, Math.PI * 2);
  context.fill();
  context.rotate(0.96);
  context.beginPath();
  context.ellipse(12, 0, 15, 30, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
  context.fillRect(317, 45, 5, 36);
  context.font = "700 72px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("AgroFlow", 320, 148);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeBoardLabelTexture(THREE: ThreeModule, title: string, subtitle: string): Texture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(245,250,246,.88)";
  context.font = "700 56px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(title, 256, 112);
  context.font = "500 26px system-ui, sans-serif";
  context.fillText(subtitle, 256, 165);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function buildHardwareModel(THREE: ThreeModule): HardwareModel {
  const root = new THREE.Group();
  root.position.y = 0.32;

  const textures: Texture[] = [];
  const surfaceTexture = makeSurfaceTexture(THREE);
  if (surfaceTexture) textures.push(surfaceTexture);

  const shell = new THREE.MeshPhysicalMaterial({
    color: 0xe3e1d9,
    roughness: 0.74,
    metalness: 0,
    clearcoat: 0.045,
    clearcoatRoughness: 0.9,
    bumpMap: surfaceTexture,
    bumpScale: 0.012,
  });
  const shellEdge = new THREE.MeshPhysicalMaterial({
    color: 0xebe9e1,
    roughness: 0.69,
    metalness: 0,
    clearcoat: 0.06,
    bumpMap: surfaceTexture,
    bumpScale: 0.008,
  });
  const innerPlastic = new THREE.MeshStandardMaterial({ color: 0xc8ccc6, roughness: 0.86, metalness: 0.01 });
  const mountingPlate = new THREE.MeshStandardMaterial({ color: 0xadb5ae, roughness: 0.72, metalness: 0.16 });
  const gasket = new THREE.MeshStandardMaterial({ color: 0x27302d, roughness: 0.92, metalness: 0 });
  const blackPolymer = new THREE.MeshStandardMaterial({ color: 0x202724, roughness: 0.82, metalness: 0.03 });
  const cableRubber = new THREE.MeshStandardMaterial({ color: 0x151b19, roughness: 0.9, metalness: 0 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9ca8a4, roughness: 0.4, metalness: 0.72, bumpMap: surfaceTexture, bumpScale: 0.008 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x47504d, roughness: 0.42, metalness: 0.62 });
  const screwSlot = new THREE.MeshStandardMaterial({ color: 0x313936, roughness: 0.45, metalness: 0.5 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xb78a43, roughness: 0.44, metalness: 0.62 });
  const pcb = new THREE.MeshStandardMaterial({ color: 0x123f34, roughness: 0.67, metalness: 0.05 });
  const pcbDark = new THREE.MeshStandardMaterial({ color: 0x17201f, roughness: 0.72, metalness: 0.04 });
  const chip = new THREE.MeshStandardMaterial({ color: 0x202525, roughness: 0.64, metalness: 0.12 });
  const rfShield = new THREE.MeshStandardMaterial({ color: 0xa8afac, roughness: 0.35, metalness: 0.76 });
  const usbMetal = new THREE.MeshStandardMaterial({ color: 0xb8c0bd, roughness: 0.3, metalness: 0.82 });
  const relayPcb = new THREE.MeshStandardMaterial({ color: 0x8d292a, roughness: 0.73, metalness: 0.02 });
  const relayBlock = new THREE.MeshStandardMaterial({ color: 0x245f91, roughness: 0.7, metalness: 0.02 });
  const terminal = new THREE.MeshStandardMaterial({ color: 0x356b55, roughness: 0.73, metalness: 0.03 });
  const sensorPcb = new THREE.MeshStandardMaterial({ color: 0x376b51, roughness: 0.76, metalness: 0.03 });
  const dhtPlastic = new THREE.MeshStandardMaterial({ color: 0xe3e5df, roughness: 0.79, metalness: 0 });
  const pipe = new THREE.MeshStandardMaterial({ color: 0x121918, roughness: 0.86, metalness: 0.02 });
  const couplingBlue = new THREE.MeshStandardMaterial({ color: 0x176693, roughness: 0.65, metalness: 0.04 });
  const wireRed = new THREE.MeshStandardMaterial({ color: 0x9d3d37, roughness: 0.82 });
  const wireBlue = new THREE.MeshStandardMaterial({ color: 0x315f75, roughness: 0.82 });
  const wireGreen = new THREE.MeshStandardMaterial({ color: 0x39765c, roughness: 0.82 });
  const wireCream = new THREE.MeshStandardMaterial({ color: 0xd4c9a2, roughness: 0.84 });
  const wireBlack = new THREE.MeshStandardMaterial({ color: 0x242c29, roughness: 0.88 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x754126, roughness: 1, metalness: 0 });

  // Galvanised round stake, backing rails and collars carry the enclosure load.
  const post = addCylinder(THREE, root, 0.22, 0.24, 7.4, [0, -1.62, -0.72], steel, 18);
  post.rotation.y = 0.08;
  addBox(THREE, root, [4.45, 0.30, 0.24], [0, 1.36, -0.48], darkSteel);
  addBox(THREE, root, [4.45, 0.30, 0.24], [0, -1.34, -0.48], darkSteel);
  for (const y of [-1.34, 1.36]) {
    addCylinder(THREE, root, 0.29, 0.29, 0.15, [0, y, -0.72], darkSteel, 18);
    addScrew(THREE, root, [-0.34, y, -0.31], steel, screwSlot, 0.68);
    addScrew(THREE, root, [0.34, y, -0.31], steel, screwSlot, 0.68);
  }

  // Small clods around the stake provide a contact edge. The photographed
  // ground remains visible beneath them; a large opaque mesh reads as a plinth.
  for (let index = 0; index < 18; index += 1) {
    const angle = index * 2.399;
    const radius = 0.75 + (index % 5) * 0.76;
    const clod = new THREE.Mesh(new THREE.DodecahedronGeometry(0.10 + (index % 3) * 0.025, 0), soil);
    clod.position.set(Math.cos(angle) * radius, -3.65 + (index % 2) * 0.025, -0.50 + Math.sin(angle) * radius * 0.21);
    clod.scale.y = 0.55;
    clod.rotation.set(angle * 0.2, angle, 0);
    clod.castShadow = true;
    root.add(clod);
  }

  // The body is a shallow moulded shell with a separate cavity, front lip and gasket.
  const enclosureBack = new THREE.Mesh(roundedPanelGeometry(THREE, 5.62, 4.15, 0.58, 0.34), shell);
  enclosureBack.position.z = -0.04;
  root.add(enclosureBack);
  const cavity = new THREE.Mesh(roundedPanelGeometry(THREE, 5.08, 3.61, 0.12, 0.24, 0.045), innerPlastic);
  cavity.position.z = 0.34;
  root.add(cavity);
  const plate = new THREE.Mesh(roundedPanelGeometry(THREE, 4.62, 3.18, 0.08, 0.17, 0.035), mountingPlate);
  plate.position.z = 0.43;
  root.add(plate);
  for (const x of [-2.13, 2.13]) {
    for (const y of [-1.38, 1.38]) addScrew(THREE, root, [x, y, 0.50], steel, screwSlot, 0.38);
  }
  const enclosureRim = new THREE.Mesh(roundedFrameGeometry(THREE, 5.52, 4.05, 0.24, 0.22, 0.31), shellEdge);
  enclosureRim.position.z = 0.46;
  root.add(enclosureRim);
  const bodyGasket = new THREE.Mesh(roundedFrameGeometry(THREE, 5.38, 3.91, 0.075, 0.055, 0.27), gasket);
  bodyGasket.position.z = 0.59;
  root.add(bodyGasket);
  const mouldingSeam = new THREE.Mesh(roundedFrameGeometry(THREE, 5.20, 3.74, 0.035, 0.018, 0.25), shell);
  mouldingSeam.position.z = 0.565;
  root.add(mouldingSeam);

  // Four moulded corner bosses remain visible when the lid is open.
  for (const x of [-2.38, 2.38]) {
    for (const y of [-1.64, 1.64]) {
      const boss = addCylinder(THREE, root, 0.16, 0.18, 0.20, [x, y, 0.48], shellEdge, 20);
      boss.rotation.x = Math.PI / 2;
      addScrewRecess(THREE, root, [x, y, 0.60], innerPlastic, steel, screwSlot, 0.72);
    }
  }

  // Exterior mounting ears and right-hand weather latches.
  for (const y of [-1.28, 1.28]) {
    const ear = new THREE.Mesh(roundedPanelGeometry(THREE, 0.72, 0.68, 0.18, 0.12, 0.035), shell);
    ear.position.set(3.00, y, -0.10);
    root.add(ear);
    addScrew(THREE, root, [3.00, y, 0.02], steel, screwSlot, 0.60);
    addBox(THREE, root, [0.18, 0.52, 0.22], [2.89, y, 0.52], darkSteel);
  }

  // Four one-to-one entry paths: soil, ambient sensor, pump output, then power.
  [-1.75, -0.58, 0.62, 1.76].forEach((x) => {
    addGland(THREE, root, x, blackPolymer, darkSteel);
    const entrySeal = addCylinder(THREE, root, 0.18, 0.18, 0.045, [x, -1.92, 0.62], gasket, 18);
    entrySeal.rotation.x = Math.PI / 2;
  });

  // ESP32 DevKit, held above the mounting plate on four stand-offs.
  const esp32 = new THREE.Group();
  esp32.position.set(-0.85, 0.48, 0.60);
  root.add(esp32);
  addStandoffs(THREE, esp32, 0.49, 0.91, -0.11, steel, darkSteel);
  addRoundedPanel(THREE, esp32, [1.16, 2.08, 0.09], [0, 0, 0], 0.07, pcb);
  addRoundedPanel(THREE, esp32, [0.72, 0.78, 0.12], [0, 0.40, 0.10], 0.035, rfShield);
  addRoundedPanel(THREE, esp32, [0.52, 0.28, 0.20], [0, -1.08, 0.08], 0.035, usbMetal);
  addRoundedPanel(THREE, esp32, [0.28, 0.30, 0.11], [0.03, -0.52, 0.10], 0.025, chip);
  addRoundedPanel(THREE, esp32, [0.16, 0.19, 0.10], [-0.26, -0.48, 0.10], 0.02, chip);
  // Boot/reset switches, mounting pads and a restrained row of SMD hints.
  for (const x of [-0.22, 0.22]) addRoundedPanel(THREE, esp32, [0.15, 0.12, 0.08], [x, -0.78, 0.12], 0.02, darkSteel);
  for (const x of [-0.46, 0.46]) {
    for (const y of [-0.88, 0.88]) addPcbHole(THREE, esp32, [x, y, 0.065], copper, pcbDark, 0.72);
  }
  for (let index = 0; index < 6; index += 1) {
    addBox(THREE, esp32, [0.10, 0.035, 0.035], [-0.22 + (index % 2) * 0.44, -0.12 + Math.floor(index / 2) * 0.12, 0.085], copper);
  }
  for (const x of [-0.49, 0.49]) {
    addBox(THREE, esp32, [0.11, 1.84, 0.11], [x, 0, 0.10], pcbDark);
    for (let index = -8; index <= 8; index += 1) {
      addBox(THREE, esp32, [0.045, 0.045, 0.11], [x, index * 0.105, 0.19], copper);
    }
  }
  const espLabelTexture = makeBoardLabelTexture(THREE, "ESP32", "Wi-Fi controller");
  if (espLabelTexture) {
    textures.push(espLabelTexture);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.61, 0.30), new THREE.MeshBasicMaterial({ map: espLabelTexture, transparent: true }));
    label.position.set(0, 0.40, 0.168);
    esp32.add(label);
  }
  for (const [x, color] of [[0.31, 0x77d8a5], [0.20, 0xe4b84d]] as const) {
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), new THREE.MeshBasicMaterial({ color }));
    led.position.set(x, -0.64, 0.17);
    esp32.add(led);
  }

  // One real-world-sized 5 V relay board.
  const relay = new THREE.Group();
  relay.position.set(0.82, -0.65, 0.61);
  root.add(relay);
  addStandoffs(THREE, relay, 0.76, 0.43, -0.11, steel, darkSteel);
  addRoundedPanel(THREE, relay, [1.72, 1.02, 0.09], [0, 0, 0], 0.07, relayPcb);
  addRoundedPanel(THREE, relay, [0.72, 0.62, 0.36], [0.20, 0.10, 0.22], 0.045, relayBlock);
  addRoundedPanel(THREE, relay, [0.25, 0.31, 0.18], [-0.28, 0.18, 0.13], 0.025, chip);
  for (const x of [-0.57, 0, 0.57]) {
    addRoundedPanel(THREE, relay, [0.34, 0.30, 0.28], [x, -0.37, 0.17], 0.025, terminal);
    addScrew(THREE, relay, [x, -0.37, 0.33], steel, screwSlot, 0.43);
  }
  addBox(THREE, relay, [0.38, 0.11, 0.13], [-0.57, 0.40, 0.12], pcbDark);
  addCylinder(THREE, relay, 0.065, 0.065, 0.15, [-0.48, 0.05, 0.14], chip, 14).rotation.x = Math.PI / 2;
  addBox(THREE, relay, [0.10, 0.28, 0.09], [-0.64, 0.08, 0.11], chip);
  for (const x of [-0.74, 0.74]) {
    for (const y of [-0.42, 0.42]) addPcbHole(THREE, relay, [x, y, 0.06], copper, pcbDark, 0.62);
  }

  // The YL-69 transmitter interface is mounted separately from its outdoor fork.
  const sensorInterface = new THREE.Group();
  sensorInterface.position.set(-1.86, -0.92, 0.60);
  root.add(sensorInterface);
  addStandoffs(THREE, sensorInterface, 0.31, 0.38, -0.10, steel, darkSteel);
  addRoundedPanel(THREE, sensorInterface, [0.76, 0.92, 0.08], [0, 0, 0], 0.05, sensorPcb);
  addRoundedPanel(THREE, sensorInterface, [0.31, 0.20, 0.16], [0, 0.17, 0.12], 0.022, terminal);
  addCylinder(THREE, sensorInterface, 0.09, 0.09, 0.08, [0, -0.20, 0.10], relayBlock, 18).rotation.x = Math.PI / 2;

  // Fused distribution/terminal strip for the low-voltage feed.
  const terminals = new THREE.Group();
  terminals.position.set(1.88, 0.48, 0.62);
  root.add(terminals);
  addRoundedPanel(THREE, terminals, [0.60, 1.66, 0.10], [0, 0, 0], 0.05, pcbDark);
  for (const y of [-0.60, -0.20, 0.20, 0.60]) {
    addRoundedPanel(THREE, terminals, [0.47, 0.28, 0.25], [0, y, 0.16], 0.025, terminal);
    addScrew(THREE, terminals, [0, y, 0.31], steel, screwSlot, 0.40);
  }

  // Internal looms continue from the exact same X positions as the lower glands.
  addCable(THREE, root, [
    new THREE.Vector3(-1.75, -1.98, 0.70), new THREE.Vector3(-2.13, -1.66, 0.82),
    new THREE.Vector3(-2.13, -1.27, 0.84), new THREE.Vector3(-1.98, -1.24, 0.84),
  ], wireGreen, 0.034);
  addCable(THREE, root, [
    new THREE.Vector3(-1.58, -0.78, 0.84), new THREE.Vector3(-2.20, -0.42, 0.89),
    new THREE.Vector3(-2.20, 1.42, 0.89), new THREE.Vector3(-1.34, 1.42, 0.87),
  ], wireCream, 0.032);
  addCable(THREE, root, [
    new THREE.Vector3(-1.66, -0.82, 0.83), new THREE.Vector3(-2.08, -0.48, 0.87),
    new THREE.Vector3(-2.08, 1.31, 0.88), new THREE.Vector3(-1.34, 1.31, 0.87),
  ], wireGreen, 0.030);
  addCable(THREE, root, [
    new THREE.Vector3(-0.58, -1.98, 0.70), new THREE.Vector3(-0.38, -1.61, 0.83),
    new THREE.Vector3(-0.38, -0.65, 0.86), new THREE.Vector3(-0.36, -0.42, 0.86),
  ], wireBlue, 0.034);
  addCable(THREE, root, [
    new THREE.Vector3(-0.68, -1.98, 0.69), new THREE.Vector3(-0.50, -1.58, 0.81),
    new THREE.Vector3(-0.50, -0.70, 0.84), new THREE.Vector3(-0.38, -0.54, 0.85),
  ], wireBlack, 0.030);
  // Relay load pair terminates at the two output screw blocks before leaving gland 3.
  addCable(THREE, root, [
    new THREE.Vector3(0.62, -1.98, 0.71), new THREE.Vector3(0.55, -1.55, 0.86),
    new THREE.Vector3(0.40, -1.21, 0.91), new THREE.Vector3(0.25, -1.04, 0.92),
  ], wireRed, 0.044);
  addCable(THREE, root, [
    new THREE.Vector3(0.73, -1.98, 0.70), new THREE.Vector3(0.80, -1.52, 0.84),
    new THREE.Vector3(0.82, -1.05, 0.92),
  ], wireBlack, 0.044);
  // Input power lands on the distribution strip, then branches to the ESP32 and relay.
  addCable(THREE, root, [
    new THREE.Vector3(1.76, -1.98, 0.71), new THREE.Vector3(2.20, -1.58, 0.84),
    new THREE.Vector3(2.20, -0.22, 0.86), new THREE.Vector3(2.10, -0.12, 0.91),
  ], wireRed, 0.044);
  addCable(THREE, root, [
    new THREE.Vector3(1.64, -1.98, 0.70), new THREE.Vector3(2.07, -1.50, 0.82),
    new THREE.Vector3(2.07, 0.17, 0.85), new THREE.Vector3(2.10, 0.28, 0.91),
  ], wireBlack, 0.044);
  addCable(THREE, root, [
    new THREE.Vector3(1.69, 0.68, 0.91), new THREE.Vector3(1.35, 1.34, 0.91),
    new THREE.Vector3(-0.18, 1.60, 0.90), new THREE.Vector3(-0.36, 1.42, 0.87),
  ], wireRed, 0.035);
  addCable(THREE, root, [
    new THREE.Vector3(1.69, 1.08, 0.91), new THREE.Vector3(1.28, 1.48, 0.90),
    new THREE.Vector3(-0.22, 1.50, 0.89), new THREE.Vector3(-0.36, 1.31, 0.87),
  ], wireBlack, 0.035);
  addCable(THREE, root, [
    new THREE.Vector3(-0.36, -0.12, 0.88), new THREE.Vector3(-0.08, -0.28, 0.91),
    new THREE.Vector3(0.03, -0.55, 0.91), new THREE.Vector3(0.25, -0.58, 0.90),
  ], wireBlue, 0.030);
  // Four restrained clips hold the perimeter looms to the mounting plate.
  for (const [x, y, rotation] of [[-2.18, 0.15, 0], [-2.18, 1.20, 0], [2.13, -0.72, 0], [2.13, 0.74, 0]] as const) {
    const clip = addRoundedPanel(THREE, root, [0.22, 0.07, 0.08], [x, y, 0.91], 0.018, blackPolymer);
    clip.rotation.z = rotation;
  }

  // Cleaner YL-69 fork: supported PCB head, paired plated prongs and buried tips.
  const soilProbe = new THREE.Group();
  soilProbe.position.set(-3.72, -2.72, 0.16);
  soilProbe.rotation.z = -0.10;
  root.add(soilProbe);
  addRoundedPanel(THREE, soilProbe, [0.70, 0.54, 0.16], [0, 0.74, 0], 0.06, sensorPcb);
  addRoundedPanel(THREE, soilProbe, [0.46, 0.20, 0.22], [0, 1.05, 0], 0.035, blackPolymer);
  addRoundedPanel(THREE, soilProbe, [0.21, 1.62, 0.075], [-0.18, -0.34, 0], 0.035, sensorPcb);
  addRoundedPanel(THREE, soilProbe, [0.21, 1.62, 0.075], [0.18, -0.34, 0], 0.035, sensorPcb);
  addBox(THREE, soilProbe, [0.13, 1.44, 0.026], [-0.18, -0.37, 0.055], copper);
  addBox(THREE, soilProbe, [0.13, 1.44, 0.026], [0.18, -0.37, 0.055], copper);
  for (const x of [-0.23, 0, 0.23]) addCylinder(THREE, soilProbe, 0.045, 0.045, 0.025, [x, 0.77, 0.10], copper, 12).rotation.x = Math.PI / 2;
  addCable(THREE, root, [
    new THREE.Vector3(-1.75, -2.48, 0.23), new THREE.Vector3(-2.42, -2.68, 0.18),
    new THREE.Vector3(-3.22, -2.43, 0.16), new THREE.Vector3(-3.69, -1.70, 0.15),
  ], cableRubber, 0.065);

  // Compact DHT11-type ambient sensor in a ventilated, supported housing.
  const dht = new THREE.Group();
  dht.position.set(3.48, 0.45, 0.02);
  root.add(dht);
  addBox(THREE, root, [0.86, 0.12, 0.16], [3.02, 0.45, -0.14], steel);
  addScrew(THREE, root, [2.70, 0.45, -0.03], steel, screwSlot, 0.48);
  const dhtBody = new THREE.Mesh(roundedPanelGeometry(THREE, 0.56, 0.70, 0.25, 0.075, 0.025), dhtPlastic);
  dht.add(dhtBody);
  for (const x of [-0.15, 0, 0.15]) {
    for (const y of [-0.20, -0.065, 0.07, 0.205]) {
      addRoundedPanel(THREE, dht, [0.070, 0.075, 0.045], [x, y, 0.145], 0.012, gasket);
    }
  }
  addRoundedPanel(THREE, dht, [0.22, 0.12, 0.16], [0, -0.41, -0.01], 0.025, blackPolymer);
  addCable(THREE, root, [
    new THREE.Vector3(-0.58, -2.48, 0.23), new THREE.Vector3(2.60, -2.56, 0.12),
    new THREE.Vector3(3.18, -1.35, 0.04), new THREE.Vector3(3.48, 0.02, 0.02),
  ], cableRubber, 0.050);

  // Pump/valve wiring is clearly electrical and only runs beside the water pipe.
  const pumpOutput = new THREE.Group();
  pumpOutput.position.set(3.30, -3.12, -0.02);
  root.add(pumpOutput);
  addCable(THREE, root, [
    new THREE.Vector3(0.62, -2.48, 0.23), new THREE.Vector3(1.34, -2.66, 0.14),
    new THREE.Vector3(2.26, -2.86, 0.04), new THREE.Vector3(3.28, -3.04, -0.02),
    new THREE.Vector3(4.70, -3.15, -0.06),
  ], cableRubber, 0.072);
  addRoundedPanel(THREE, pumpOutput, [0.54, 0.36, 0.30], [0, 0, 0], 0.055, blackPolymer);
  addRoundedPanel(THREE, pumpOutput, [0.34, 0.14, 0.18], [0.33, 0, 0], 0.025, couplingBlue);
  const pipeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(2.75, -3.52, -0.43), new THREE.Vector3(4.10, -3.52, -0.43),
    new THREE.Vector3(5.55, -3.50, -0.46), new THREE.Vector3(6.25, -3.45, -0.50),
  ]);
  root.add(new THREE.Mesh(new THREE.TubeGeometry(pipeCurve, 36, 0.145, 14, false), pipe));
  for (const x of [3.72, 4.05]) {
    const collar = addCylinder(THREE, root, 0.22, 0.22, 0.20, [x, -3.52, -0.43], couplingBlue, 16);
    collar.rotation.z = Math.PI / 2;
  }
  const elbow = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.145, 12, 24, Math.PI / 2), pipe);
  elbow.position.set(5.78, -3.16, -0.46);
  elbow.rotation.z = -Math.PI / 2;
  root.add(elbow);

  // The fourth gland is the low-voltage input, routed away from the wet side.
  const powerInput = new THREE.Group();
  powerInput.position.set(1.76, -2.47, 0.23);
  root.add(powerInput);
  addCable(THREE, root, [
    new THREE.Vector3(1.76, -2.48, 0.23), new THREE.Vector3(1.90, -2.78, 0.10),
    new THREE.Vector3(1.98, -3.26, -0.12), new THREE.Vector3(1.98, -3.84, -0.38),
  ], cableRubber, 0.075);

  // Door-style lid: the group origin is the real left-side hinge axis.
  const lid = new THREE.Group();
  lid.position.set(-2.86, 0, 0.73);
  root.add(lid);
  const lidPanel = new THREE.Mesh(roundedPanelGeometry(THREE, 5.72, 4.25, 0.28, 0.36), shellEdge);
  lidPanel.position.set(2.84, 0, 0.14);
  lid.add(lidPanel);
  const lidRecess = new THREE.Mesh(roundedFrameGeometry(THREE, 5.35, 3.88, 0.13, 0.09, 0.28), shell);
  lidRecess.position.set(2.84, 0, 0.31);
  lid.add(lidRecess);
  const lidInner = new THREE.Mesh(roundedPanelGeometry(THREE, 4.96, 3.48, 0.07, 0.22, 0.025), innerPlastic);
  lidInner.position.set(2.84, 0, -0.085);
  lid.add(lidInner);
  const lidGasket = new THREE.Mesh(roundedFrameGeometry(THREE, 5.36, 3.89, 0.075, 0.055, 0.28), gasket);
  lidGasket.position.set(2.84, 0, -0.035);
  lid.add(lidGasket);
  // Moulded ribs and screw bosses on the inside of the lid.
  for (const y of [-1.28, 0, 1.28]) addRoundedPanel(THREE, lid, [4.62, 0.075, 0.10], [2.84, y, -0.17], 0.018, shell);
  for (const x of [1.34, 2.84, 4.34]) addRoundedPanel(THREE, lid, [0.075, 2.45, 0.10], [x, 0, -0.17], 0.018, shell);
  for (const [x, y] of [[1.25, 1.20], [4.43, 1.20], [1.25, -1.20], [4.43, -1.20]] as const) {
    const gusset = addBox(THREE, lid, [0.46, 0.07, 0.08], [x, y, -0.16], shell);
    gusset.rotation.z = Math.sign(x - 2.84) * Math.sign(y) * 0.72;
  }
  for (const x of [0.48, 5.20]) {
    for (const y of [-1.61, 1.61]) {
      const boss = addCylinder(THREE, lid, 0.15, 0.17, 0.16, [x, y, -0.17], shell, 20);
      boss.rotation.x = Math.PI / 2;
      addScrewRecess(THREE, lid, [x, y, 0.32], shell, steel, screwSlot, 0.82);
    }
  }
  const brandTexture = makeBrandTexture(THREE);
  if (brandTexture) {
    textures.push(brandTexture);
    const brand = new THREE.Mesh(
      new THREE.PlaneGeometry(2.42, 0.83),
      new THREE.MeshStandardMaterial({ map: brandTexture, transparent: true, depthWrite: false, roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    brand.position.set(2.84, -0.03, 0.382);
    lid.add(brand);
  }

  // Two-part hinge barrels and pins make the pivot visually legible.
  for (const y of [-1.24, 1.24]) {
    addCylinder(THREE, root, 0.16, 0.16, 0.28, [-2.86, y - 0.16, 0.73], shell, 18);
    addCylinder(THREE, root, 0.16, 0.16, 0.20, [-2.86, y + 0.18, 0.73], shellEdge, 18);
    addCylinder(THREE, root, 0.068, 0.068, 0.62, [-2.86, y, 0.73], steel, 14);
    addRoundedPanel(THREE, lid, [0.48, 0.32, 0.18], [0.20, y, -0.10], 0.045, shell);
  }

  const sensePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-3.72, -1.65, 0.50),
    new THREE.Vector3(-2.05, -0.94, 0.94),
    new THREE.Vector3(-0.85, 0.48, 1.00),
  ]);
  const actPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.85, 0.48, 1.00),
    new THREE.Vector3(0.82, -0.65, 1.02),
    new THREE.Vector3(3.30, -3.12, 0.42),
  ]);
  const signalMaterial = new THREE.MeshBasicMaterial({ color: 0x39aeb2, transparent: true, opacity: 0.34 });
  const senseSignal = new THREE.Group();
  senseSignal.add(new THREE.Mesh(new THREE.TubeGeometry(sensePath, 40, 0.022, 7, false), signalMaterial));
  const sensePulse = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 9), new THREE.MeshBasicMaterial({ color: 0x8be0dc }));
  senseSignal.add(sensePulse);
  senseSignal.visible = false;
  root.add(senseSignal);
  const actSignal = new THREE.Group();
  actSignal.add(new THREE.Mesh(new THREE.TubeGeometry(actPath, 48, 0.022, 7, false), signalMaterial.clone()));
  const actPulse = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 9), new THREE.MeshBasicMaterial({ color: 0x8be0dc }));
  actSignal.add(actPulse);
  actSignal.visible = false;
  root.add(actSignal);

  const waterDrops: Mesh[] = [];
  const waterMaterial = new THREE.MeshBasicMaterial({ color: 0x3eb7c5, transparent: true, opacity: 0.70 });
  for (let index = 0; index < 3; index += 1) {
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 8), waterMaterial);
    drop.scale.y = 1.55;
    root.add(drop);
    waterDrops.push(drop);
  }

  const anchors: Record<ComponentKey, Object3D> = {
    esp32: addAnchor(THREE, esp32, [0, 0.30, 0.42]),
    relay: addAnchor(THREE, relay, [0.12, 0.02, 0.53]),
    soil: addAnchor(THREE, soilProbe, [0, 0.80, 0.34]),
    dht: addAnchor(THREE, dht, [0, 0.05, 0.28]),
    pump: addAnchor(THREE, pumpOutput, [0.18, 0.16, 0.40]),
    power: addAnchor(THREE, powerInput, [0, 0.02, 0.34]),
  };
  const openAnchors: Partial<Record<ComponentKey, Object3D>> = {
    soil: addAnchor(THREE, sensorInterface, [0, 0.04, 0.42]),
    pump: addAnchor(THREE, relay, [0.56, -0.30, 0.52]),
    power: addAnchor(THREE, terminals, [0, -0.40, 0.48]),
  };

  return {
    root,
    lid,
    anchors,
    openAnchors,
    componentMaterials: {
      esp32: [pcb, pcbDark, rfShield],
      relay: [relayPcb, relayBlock],
      soil: [sensorPcb, copper],
      dht: [dhtPlastic],
      pump: [couplingBlue],
      power: [wireRed, wireBlack],
    },
    sensePath,
    actPath,
    senseSignal,
    actSignal,
    sensePulse,
    actPulse,
    waterDrops,
    textures,
  };
}

export function adaptivePixelRatio(width: number): number {
  const cap = width < 560 ? 1 : width < 1024 ? 1.25 : 1.5;
  return Math.min(window.devicePixelRatio || 1, cap);
}

export function createHardwareScene(THREE: ThreeModule, width: number, height: number): HardwareScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, width / Math.max(height, 1), 0.1, 100);
  camera.position.set(0.35, 0.15, 14.6);
  camera.lookAt(0, 0.05, 0);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: width >= 560,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(adaptivePixelRatio(width));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const sky = new THREE.HemisphereLight(0xe9f4ff, 0x69462f, 1.48);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffefd5, 3.45);
  sun.position.set(-5.5, 8.2, 7.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(width < 700 ? 512 : 1024, width < 700 ? 512 : 1024);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -6;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 24;
  sun.shadow.bias = -0.00045;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fd5d4, 0.72);
  fill.position.set(5, 2, 5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xb8d2ec, 0.38);
  rim.position.set(2, 4, -6);
  scene.add(rim);
  const frontFill = new THREE.PointLight(0xfff2de, 0.62, 24, 2);
  frontFill.position.set(-1.5, 1.8, 8);
  scene.add(frontFill);

  const model = buildHardwareModel(THREE);
  model.root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  scene.add(model.root);

  // A transparent receiver supplies the contact shadow that ties the procedural
  // assembly into the photographed soil without covering the field image.
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 5.4),
    new THREE.ShadowMaterial({ color: 0x1e1710, opacity: 0.28 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.15, -3.69, -0.52);
  shadow.receiveShadow = true;
  scene.add(shadow);

  return { scene, camera, renderer, model };
}

export function disposeHardwareScene(scene: Scene, renderer: WebGLRenderer, textures: Texture[]): void {
  const materials = new Set<Material>();
  scene.traverse((object) => {
    const mesh = object as Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => materials.add(entry));
    else if (material) materials.add(material);
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  renderer.renderLists.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  renderer.domElement.remove();
}
