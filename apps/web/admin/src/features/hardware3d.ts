import type {
  BufferGeometry,
  Camera,
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
type ComponentKey = "esp32" | "soil" | "dht" | "relay" | "pump" | "power";

interface HardwareModel {
  root: Group;
  lid: Group;
  anchors: Record<ComponentKey, Object3D>;
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

interface StoryFrame {
  rotation: number;
  lidOpen: number;
  cameraZ: number;
  cameraX: number;
}

const COMPONENT_COPY: Record<ComponentKey, { title: string; body: string }> = {
  esp32: {
    title: "ESP32 Controller",
    body: "Reads connected sensors, maintains device connectivity and executes commands sent to the irrigation node.",
  },
  soil: {
    title: "Soil Moisture Sensor",
    body: "Measures moisture in the crop zone so AgroFlow can track field conditions.",
  },
  dht: {
    title: "DHT11 Sensor",
    body: "Measures the temperature and humidity around the crop zone.",
  },
  relay: {
    title: "Relay Module",
    body: "Electrically switches the pump on or off when the controller receives an irrigation command.",
  },
  pump: {
    title: "Pump Output",
    body: "Connects the relay-controlled output to the irrigation pump circuit.",
  },
  power: {
    title: "Power Input",
    body: "Supplies the field controller and its connected low-voltage electronics.",
  },
};

const STORY_FRAMES: StoryFrame[] = [
  { rotation: -0.30, lidOpen: 0, cameraZ: 14.1, cameraX: 0.2 },
  { rotation: 0.38, lidOpen: 0, cameraZ: 14.0, cameraX: -0.15 },
  { rotation: 0.12, lidOpen: 1, cameraZ: 16.3, cameraX: 0 },
  { rotation: -0.08, lidOpen: 1, cameraZ: 16.3, cameraX: -0.1 },
  { rotation: 0.14, lidOpen: 1, cameraZ: 16.3, cameraX: 0.1 },
  { rotation: -0.18, lidOpen: 0.76, cameraZ: 16.5, cameraX: 0 },
];

const HOTSPOTS_BY_STAGE: ComponentKey[][] = [
  [],
  ["soil", "dht", "pump", "power"],
  ["esp32", "relay", "soil", "dht", "pump", "power"],
  ["soil", "dht", "esp32"],
  ["esp32", "relay", "pump"],
  ["esp32", "relay", "soil", "dht", "pump", "power"],
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function interpolateFrame(progress: number): StoryFrame {
  const start = Math.floor(progress);
  const end = Math.min(STORY_FRAMES.length - 1, start + 1);
  const amount = progress - start;
  const a = STORY_FRAMES[start] ?? STORY_FRAMES[0]!;
  const b = STORY_FRAMES[end] ?? a;
  return {
    rotation: mix(a.rotation, b.rotation, amount),
    lidOpen: mix(a.lidOpen, b.lidOpen, amount),
    cameraZ: mix(a.cameraZ, b.cameraZ, amount),
    cameraX: mix(a.cameraX, b.cameraX, amount),
  };
}

function roundedPanelGeometry(
  THREE: ThreeModule,
  width: number,
  height: number,
  depth: number,
  radius: number,
): BufferGeometry {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: Math.min(radius * 0.35, 0.12),
    bevelThickness: Math.min(depth * 0.18, 0.08),
    curveSegments: 6,
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

function addCable(
  THREE: ThreeModule,
  parent: Object3D,
  points: Vector3[],
  material: Material,
  radius = 0.035,
): Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, radius, 7, false), material);
  parent.add(cable);
  return cable;
}

function addAnchor(THREE: ThreeModule, parent: Object3D, position: [number, number, number]): Object3D {
  const anchor = new THREE.Object3D();
  anchor.position.set(...position);
  parent.add(anchor);
  return anchor;
}

function makeBrandTexture(THREE: ThreeModule): Texture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#184d35";
  context.font = "700 66px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("AgroFlow", 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function buildHardwareModel(THREE: ThreeModule): HardwareModel {
  const root = new THREE.Group();
  root.position.y = 0.25;

  const offWhite = new THREE.MeshStandardMaterial({ color: 0xe8ebe6, roughness: 0.77, metalness: 0.02 });
  const edgeWhite = new THREE.MeshStandardMaterial({ color: 0xf5f6f1, roughness: 0.68, metalness: 0.01 });
  const cavity = new THREE.MeshStandardMaterial({ color: 0x2e3834, roughness: 0.9, metalness: 0.02 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x202724, roughness: 0.88, metalness: 0.05 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xaeb8b5, roughness: 0.34, metalness: 0.72 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xd2a54c, roughness: 0.45, metalness: 0.55 });
  const espMaterial = new THREE.MeshStandardMaterial({ color: 0x163d34, roughness: 0.68, metalness: 0.04 });
  const espMetal = new THREE.MeshStandardMaterial({ color: 0xbac5c3, roughness: 0.31, metalness: 0.74 });
  const relayMaterial = new THREE.MeshStandardMaterial({ color: 0x9e3130, roughness: 0.72, metalness: 0.02 });
  const relayBlue = new THREE.MeshStandardMaterial({ color: 0x23669c, roughness: 0.67, metalness: 0.03 });
  const interfaceMaterial = new THREE.MeshStandardMaterial({ color: 0x34745a, roughness: 0.72, metalness: 0.02 });
  const sensorMaterial = new THREE.MeshStandardMaterial({ color: 0x517864, roughness: 0.74, metalness: 0.02 });
  const dhtMaterial = new THREE.MeshStandardMaterial({ color: 0x3a88ad, roughness: 0.72, metalness: 0.01 });
  const pumpMaterial = new THREE.MeshStandardMaterial({ color: 0x238f99, roughness: 0.65, metalness: 0.08 });
  const powerMaterial = new THREE.MeshStandardMaterial({ color: 0x474f4c, roughness: 0.75, metalness: 0.12 });
  const terminalMaterial = new THREE.MeshStandardMaterial({ color: 0x51705f, roughness: 0.75, metalness: 0.03 });
  const wireRed = new THREE.MeshStandardMaterial({ color: 0xc9564e, roughness: 0.75 });
  const wireYellow = new THREE.MeshStandardMaterial({ color: 0xd6ad43, roughness: 0.75 });
  const wireGreen = new THREE.MeshStandardMaterial({ color: 0x43a074, roughness: 0.75 });
  const wireDark = new THREE.MeshStandardMaterial({ color: 0x283632, roughness: 0.8 });

  const body = new THREE.Mesh(roundedPanelGeometry(THREE, 5.55, 4.1, 0.74, 0.28), offWhite);
  root.add(body);
  const cavityPlate = new THREE.Mesh(roundedPanelGeometry(THREE, 4.95, 3.48, 0.10, 0.18), cavity);
  cavityPlate.position.z = 0.43;
  root.add(cavityPlate);

  // Raised rim, mounting flanges and the four retained lid screws make the
  // enclosure read as a weatherproof junction box rather than a flat panel.
  addBox(THREE, root, [5.02, 0.12, 0.14], [0, 1.77, 0.51], edgeWhite);
  addBox(THREE, root, [5.02, 0.12, 0.14], [0, -1.77, 0.51], edgeWhite);
  addBox(THREE, root, [0.12, 3.45, 0.14], [-2.51, 0, 0.51], edgeWhite);
  addBox(THREE, root, [0.12, 3.45, 0.14], [2.51, 0, 0.51], edgeWhite);
  for (const x of [-3.0, 3.0]) {
    addBox(THREE, root, [0.72, 0.68, 0.18], [x, 1.25, -0.1], offWhite);
    addBox(THREE, root, [0.72, 0.68, 0.18], [x, -1.25, -0.1], offWhite);
  }

  const esp32 = new THREE.Group();
  esp32.position.set(-0.55, 0.62, 0.60);
  root.add(esp32);
  addBox(THREE, esp32, [1.75, 1.05, 0.10], [0, 0, 0], espMaterial);
  addBox(THREE, esp32, [0.92, 0.56, 0.11], [0.12, 0.10, 0.10], espMetal);
  for (const side of [-0.72, 0.72]) {
    for (let index = -4; index <= 4; index += 1) {
      addBox(THREE, esp32, [0.05, 0.05, 0.13], [side, index * 0.10, 0.09], copper);
    }
  }

  const relay = new THREE.Group();
  relay.position.set(0.72, -0.77, 0.60);
  root.add(relay);
  addBox(THREE, relay, [2.15, 1.12, 0.11], [0, 0, 0], relayMaterial);
  addBox(THREE, relay, [0.64, 0.70, 0.34], [-0.38, 0.04, 0.19], relayBlue);
  addBox(THREE, relay, [0.64, 0.70, 0.34], [0.38, 0.04, 0.19], relayBlue);
  for (const x of [-0.78, 0, 0.78]) {
    addBox(THREE, relay, [0.28, 0.23, 0.20], [x, -0.42, 0.13], terminalMaterial);
  }

  const sensorInterface = new THREE.Group();
  sensorInterface.position.set(-1.70, -0.80, 0.60);
  root.add(sensorInterface);
  addBox(THREE, sensorInterface, [0.72, 0.88, 0.10], [0, 0, 0], interfaceMaterial);
  addBox(THREE, sensorInterface, [0.35, 0.22, 0.16], [0, 0.18, 0.11], terminalMaterial);

  const terminals = new THREE.Group();
  terminals.position.set(1.80, 0.70, 0.60);
  root.add(terminals);
  for (const y of [-0.55, -0.18, 0.19, 0.56]) {
    addBox(THREE, terminals, [0.48, 0.27, 0.20], [0, y, 0], terminalMaterial);
  }

  addCable(THREE, root, [new THREE.Vector3(-1.55, -0.85, 0.76), new THREE.Vector3(-1.25, -0.20, 0.79), new THREE.Vector3(-1.00, 0.45, 0.78)], wireGreen);
  addCable(THREE, root, [new THREE.Vector3(0.15, 0.52, 0.78), new THREE.Vector3(0.35, 0.05, 0.80), new THREE.Vector3(0.48, -0.62, 0.79)], wireYellow);
  addCable(THREE, root, [new THREE.Vector3(1.62, 0.83, 0.77), new THREE.Vector3(1.38, 0.10, 0.80), new THREE.Vector3(1.20, -0.61, 0.78)], wireRed);

  const glandPositions = [-1.8, -0.6, 0.6, 1.8];
  for (const x of glandPositions) {
    const gland = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.50, 16), rubber);
    gland.position.set(x, -2.20, 0.02);
    root.add(gland);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.16, 6), rubber);
    collar.position.set(x, -2.02, 0.02);
    root.add(collar);
  }

  const soilProbe = new THREE.Group();
  soilProbe.position.set(-3.70, -2.70, 0.15);
  soilProbe.rotation.z = -0.16;
  root.add(soilProbe);
  addBox(THREE, soilProbe, [0.56, 2.20, 0.11], [0, -0.34, 0], sensorMaterial);
  addBox(THREE, soilProbe, [0.13, 1.20, 0.04], [-0.13, -0.50, 0.08], copper);
  addBox(THREE, soilProbe, [0.13, 1.20, 0.04], [0.13, -0.50, 0.08], copper);
  addBox(THREE, soilProbe, [0.78, 0.54, 0.17], [0, 0.90, 0], interfaceMaterial);
  addCable(THREE, root, [new THREE.Vector3(-1.8, -2.43, 0.03), new THREE.Vector3(-2.65, -2.55, 0.08), new THREE.Vector3(-3.62, -1.80, 0.15)], wireDark, 0.055);

  const dht = new THREE.Group();
  dht.position.set(3.58, 0.15, 0.18);
  root.add(dht);
  addBox(THREE, dht, [0.85, 1.05, 0.30], [0, 0, 0], dhtMaterial);
  for (const x of [-0.23, 0, 0.23]) {
    for (const y of [-0.28, 0, 0.28]) {
      addBox(THREE, dht, [0.10, 0.14, 0.04], [x, y, 0.17], cavity);
    }
  }
  addCable(THREE, root, [new THREE.Vector3(-0.6, -2.43, 0.02), new THREE.Vector3(2.75, -2.70, -0.05), new THREE.Vector3(3.55, -0.43, 0.08)], wireYellow, 0.05);

  const pumpOutput = new THREE.Group();
  pumpOutput.position.set(3.62, -2.55, 0.05);
  root.add(pumpOutput);
  const pumpSocket = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.62, 18), pumpMaterial);
  pumpSocket.rotation.z = Math.PI / 2;
  pumpOutput.add(pumpSocket);
  addCable(THREE, root, [new THREE.Vector3(0.6, -2.43, 0.03), new THREE.Vector3(1.9, -2.55, 0.05), new THREE.Vector3(3.30, -2.55, 0.05)], wireGreen, 0.06);

  const powerInput = new THREE.Group();
  powerInput.position.set(2.10, -3.34, 0.04);
  root.add(powerInput);
  addBox(THREE, powerInput, [0.72, 0.52, 0.33], [0, 0, 0], powerMaterial);
  addBox(THREE, powerInput, [0.08, 0.19, 0.13], [-0.13, -0.31, 0], steel);
  addBox(THREE, powerInput, [0.08, 0.19, 0.13], [0.13, -0.31, 0], steel);
  addCable(THREE, root, [new THREE.Vector3(1.8, -2.43, 0.03), new THREE.Vector3(1.92, -2.72, 0.03), new THREE.Vector3(2.10, -3.08, 0.03)], wireRed, 0.06);

  const antenna = new THREE.Group();
  antenna.position.set(2.94, 0.58, 0);
  root.add(antenna);
  const antennaStem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.18, 12), rubber);
  antennaStem.position.y = 0.55;
  antenna.add(antennaStem);
  const antennaCap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), rubber);
  antennaCap.position.y = 1.14;
  antenna.add(antennaCap);

  const lid = new THREE.Group();
  lid.position.set(0, 0, 0.88);
  root.add(lid);
  const lidPanel = new THREE.Mesh(roundedPanelGeometry(THREE, 5.68, 4.23, 0.32, 0.30), edgeWhite);
  lid.add(lidPanel);
  for (const x of [-2.30, 2.30]) {
    for (const y of [-1.57, 1.57]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.06, 18), steel);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(x, y, 0.20);
      lid.add(screw);
      addBox(THREE, lid, [0.12, 0.025, 0.025], [x, y, 0.24], rubber);
    }
  }

  const textures: Texture[] = [];
  const brandTexture = makeBrandTexture(THREE);
  if (brandTexture) {
    textures.push(brandTexture);
    const brand = new THREE.Mesh(
      new THREE.PlaneGeometry(2.20, 0.55),
      new THREE.MeshBasicMaterial({ map: brandTexture, transparent: true, depthWrite: false }),
    );
    brand.position.set(0, 0.05, 0.29);
    lid.add(brand);
  }

  const sensePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-3.70, -1.75, 0.55),
    new THREE.Vector3(-2.15, -0.95, 1.02),
    new THREE.Vector3(-0.55, 0.62, 1.10),
  ]);
  const actPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.55, 0.62, 1.10),
    new THREE.Vector3(0.72, -0.77, 1.10),
    new THREE.Vector3(3.62, -2.55, 0.62),
  ]);
  const signalMaterial = new THREE.MeshBasicMaterial({ color: 0x42c3c7, transparent: true, opacity: 0.38 });
  const senseSignal = new THREE.Group();
  senseSignal.add(new THREE.Mesh(new THREE.TubeGeometry(sensePath, 38, 0.024, 7, false), signalMaterial));
  const sensePulse = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 10), new THREE.MeshBasicMaterial({ color: 0x8edddf }));
  senseSignal.add(sensePulse);
  senseSignal.visible = false;
  root.add(senseSignal);

  const actSignal = new THREE.Group();
  actSignal.add(new THREE.Mesh(new THREE.TubeGeometry(actPath, 48, 0.024, 7, false), signalMaterial.clone()));
  const actPulse = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 10), new THREE.MeshBasicMaterial({ color: 0x8edddf }));
  actSignal.add(actPulse);
  actSignal.visible = false;
  root.add(actSignal);

  const waterDrops: Mesh[] = [];
  const waterMaterial = new THREE.MeshBasicMaterial({ color: 0x42c3c7, transparent: true, opacity: 0.75 });
  for (let index = 0; index < 3; index += 1) {
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), waterMaterial);
    drop.scale.y = 1.6;
    root.add(drop);
    waterDrops.push(drop);
  }

  const anchors: Record<ComponentKey, Object3D> = {
    esp32: addAnchor(THREE, esp32, [0, 0.22, 0.35]),
    relay: addAnchor(THREE, relay, [0.15, 0, 0.48]),
    soil: addAnchor(THREE, soilProbe, [0, 0.75, 0.35]),
    dht: addAnchor(THREE, dht, [0, 0.15, 0.42]),
    pump: addAnchor(THREE, pumpOutput, [0.10, 0.25, 0.42]),
    power: addAnchor(THREE, powerInput, [0, 0, 0.42]),
  };

  return {
    root,
    lid,
    anchors,
    componentMaterials: {
      esp32: [espMaterial, espMetal],
      relay: [relayMaterial, relayBlue],
      soil: [sensorMaterial, interfaceMaterial],
      dht: [dhtMaterial],
      pump: [pumpMaterial],
      power: [powerMaterial],
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

function createScene(THREE: ThreeModule, width: number, height: number): {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  model: HardwareModel;
} {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, width / Math.max(height, 1), 0.1, 100);
  camera.position.set(0.2, 0.1, 14.1);
  camera.lookAt(0, 0.1, 0);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const hemisphere = new THREE.HemisphereLight(0xf7fffb, 0x49625a, 2.0);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-4, 6, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8edddf, 1.25);
  fill.position.set(5, 1, 5);
  scene.add(fill);

  const backdrop = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.045, depthWrite: false }),
  );
  backdrop.position.set(0, -0.15, -0.75);
  backdrop.scale.y = 0.88;
  scene.add(backdrop);

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(3.8, 4.1, 0.16, 48),
    new THREE.MeshStandardMaterial({ color: 0xb7cac1, roughness: 0.95, transparent: true, opacity: 0.26 }),
  );
  platform.position.set(0, -4.05, -0.35);
  scene.add(platform);

  const model = buildHardwareModel(THREE);
  scene.add(model.root);
  return { scene, camera, renderer, model };
}

function disposeScene(scene: Scene, renderer: WebGLRenderer, textures: Texture[]): void {
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

/**
 * Lazily mounts the landing-page hardware story. The heavy Three.js chunk is
 * requested only when the section approaches the viewport. A DOM observer
 * owns teardown because main.ts replaces #root when the visitor opens login.
 */
export function initHardwareShowcase(root: HTMLElement): void {
  const section = root.querySelector<HTMLElement>("[data-hardware-showcase]");
  const viewer = root.querySelector<HTMLElement>("[data-hardware-viewer]");
  const canvasMount = root.querySelector<HTMLElement>("[data-hardware-canvas]");
  const info = root.querySelector<HTMLElement>("#hardwareComponentInfo");
  if (!section || !viewer || !canvasMount || !info || viewer.dataset["initialized"] === "true") return;
  viewer.dataset["initialized"] = "true";
  // Stable aliases preserve the guard above across event and async callbacks.
  const viewerElement: HTMLElement = viewer;
  const mountElement: HTMLElement = canvasMount;
  const infoElement: HTMLElement = info;

  const stages = Array.from(section.querySelectorAll<HTMLElement>("[data-hardware-stage]"));
  const hotspotButtons = new Map<ComponentKey, HTMLButtonElement>();
  section.querySelectorAll<HTMLButtonElement>("[data-hardware-hotspot]").forEach((button) => {
    const key = button.dataset["hardwareHotspot"] as ComponentKey | undefined;
    if (key && key in COMPONENT_COPY) hotspotButtons.set(key, button);
  });

  const abort = new AbortController();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let destroyed = false;
  let loading = false;
  let visible = false;
  let progress = 0;
  let userRotation = 0;
  let activeStage = 0;
  let frameRequest = 0;
  let renderer: WebGLRenderer | null = null;
  let scene: Scene | null = null;
  let camera: PerspectiveCamera | null = null;
  let model: HardwareModel | null = null;
  let THREE: ThreeModule | null = null;
  let dragStart: { pointerId: number; x: number; y: number; rotation: number; horizontal: boolean } | null = null;

  function setActiveStory(nextStage: number): void {
    activeStage = clamp(nextStage, 0, stages.length - 1);
    stages.forEach((stage, index) => stage.classList.toggle("is-active", index === activeStage));
  }

  function readStoryProgress(): number {
    if (reducedMotion.matches) return 2;
    const viewportLine = window.innerHeight * 0.5;
    const centers = stages.map((stage) => {
      const bounds = stage.getBoundingClientRect();
      return bounds.top + bounds.height / 2;
    });
    if (centers.length < 2 || viewportLine <= (centers[0] ?? 0)) return 0;
    const last = centers.length - 1;
    if (viewportLine >= (centers[last] ?? viewportLine)) return last;
    for (let index = 0; index < last; index += 1) {
      const start = centers[index] ?? viewportLine;
      const end = centers[index + 1] ?? start + 1;
      if (viewportLine >= start && viewportLine <= end) {
        return index + (viewportLine - start) / Math.max(1, end - start);
      }
    }
    return 0;
  }

  function shouldAnimate(): boolean {
    return !reducedMotion.matches && visible && (activeStage === 3 || activeStage === 4);
  }

  function updateHotspots(): void {
    if (!model || !camera) return;
    const bounds = viewerElement.getBoundingClientRect();
    const visibleKeys = HOTSPOTS_BY_STAGE[activeStage] ?? [];
    const point = model.root.position.clone();
    hotspotButtons.forEach((button, key) => {
      const show = visibleKeys.includes(key);
      button.hidden = !show;
      if (!show) return;
      model!.anchors[key].getWorldPosition(point);
      point.project(camera! as Camera);
      const x = clamp((point.x * 0.5 + 0.5) * bounds.width, 70, Math.max(70, bounds.width - 70));
      const y = clamp((-point.y * 0.5 + 0.5) * bounds.height, 34, Math.max(34, bounds.height - 164));
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
    });
  }

  function updateFocus(): void {
    if (!model) return;
    const focus: ComponentKey[] = activeStage === 3
      ? ["soil", "dht", "esp32"]
      : activeStage === 4
        ? ["esp32", "relay", "pump"]
        : [];
    Object.entries(model.componentMaterials).forEach(([key, materials]) => {
      const dimmed = focus.length > 0 && !focus.includes(key as ComponentKey);
      materials.forEach((material) => {
        material.transparent = dimmed;
        material.opacity = dimmed ? 0.28 : 1;
        material.depthWrite = !dimmed;
      });
    });
    model.senseSignal.visible = activeStage === 3;
    model.actSignal.visible = activeStage === 4;
    model.waterDrops.forEach((drop) => { drop.visible = activeStage === 4; });
  }

  function applyStoryState(time: number): void {
    if (!model || !camera) return;
    const storyProgress = reducedMotion.matches ? 2 : progress;
    const state = interpolateFrame(storyProgress);
    model.root.rotation.y = state.rotation + userRotation;
    model.lid.position.set(0.30 * state.lidOpen, 3.10 * state.lidOpen, 0.88 + 1.35 * state.lidOpen);
    model.lid.rotation.x = -0.18 * state.lidOpen;
    model.lid.rotation.z = -0.04 * state.lidOpen;
    camera.position.set(state.cameraX, 0.05, state.cameraZ);
    camera.lookAt(0, 0.10 + 0.30 * state.lidOpen, 0);

    const pulse = (time * 0.00034) % 1;
    if (model.senseSignal.visible) model.sensePath.getPoint(pulse, model.sensePulse.position);
    if (model.actSignal.visible) model.actPath.getPoint(pulse, model.actPulse.position);
    model.waterDrops.forEach((drop, index) => {
      const fall = (pulse + index / model!.waterDrops.length) % 1;
      drop.position.set(4.02 + fall * 0.62, -2.54 - fall * 0.32, 0.08);
      if (!Array.isArray(drop.material)) drop.material.opacity = 0.72 * (1 - fall);
    });
  }

  function renderFrame(time: number): void {
    frameRequest = 0;
    if (destroyed || !visible || !renderer || !scene || !camera) return;
    applyStoryState(time);
    updateHotspots();
    renderer.render(scene, camera);
    if (shouldAnimate()) frameRequest = window.requestAnimationFrame(renderFrame);
  }

  function requestRender(): void {
    if (!frameRequest && visible && renderer) frameRequest = window.requestAnimationFrame(renderFrame);
  }

  function syncStory(): void {
    progress = clamp(readStoryProgress(), 0, STORY_FRAMES.length - 1);
    const nextStage = reducedMotion.matches ? 2 : Math.round(progress);
    if (nextStage !== activeStage) {
      setActiveStory(nextStage);
      updateFocus();
    }
    requestRender();
  }

  function resize(): void {
    if (!renderer || !camera) return;
    const width = Math.max(1, mountElement.clientWidth);
    const height = Math.max(1, mountElement.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }

  function selectComponent(key: ComponentKey): void {
    const copy = COMPONENT_COPY[key];
    infoElement.innerHTML = `<strong>${copy.title}</strong><span>${copy.body}</span>`;
    hotspotButtons.forEach((button, buttonKey) => {
      const selected = key === buttonKey;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  hotspotButtons.forEach((button, key) => {
    button.addEventListener("click", () => selectComponent(key), { signal: abort.signal });
  });

  section.querySelector<HTMLButtonElement>("[data-hardware-rotate='left']")?.addEventListener("click", () => {
    userRotation -= 0.28;
    requestRender();
  }, { signal: abort.signal });
  section.querySelector<HTMLButtonElement>("[data-hardware-rotate='right']")?.addEventListener("click", () => {
    userRotation += 0.28;
    requestRender();
  }, { signal: abort.signal });
  section.querySelector<HTMLButtonElement>("[data-hardware-reset]")?.addEventListener("click", () => {
    userRotation = 0;
    requestRender();
  }, { signal: abort.signal });

  mountElement.addEventListener("pointerdown", (event) => {
    if (!renderer || event.button !== 0) return;
    dragStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rotation: userRotation, horizontal: false };
  }, { signal: abort.signal });
  mountElement.addEventListener("pointermove", (event) => {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    if (!dragStart.horizontal && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
      dragStart.horizontal = true;
      mountElement.setPointerCapture(event.pointerId);
    }
    if (!dragStart.horizontal) return;
    event.preventDefault();
    userRotation = dragStart.rotation + dx * 0.008;
    requestRender();
  }, { signal: abort.signal });
  const endDrag = (event: PointerEvent): void => {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    if (mountElement.hasPointerCapture(event.pointerId)) mountElement.releasePointerCapture(event.pointerId);
    dragStart = null;
  };
  mountElement.addEventListener("pointerup", endDrag, { signal: abort.signal });
  mountElement.addEventListener("pointercancel", endDrag, { signal: abort.signal });

  const resizeObserver = new ResizeObserver(resize);
  const activityObserver = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    if (!visible && frameRequest) {
      window.cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
    if (visible) requestRender();
  }, { rootMargin: "220px 0px" });
  activityObserver.observe(section);

  async function loadViewer(): Promise<void> {
    if (loading || destroyed) return;
    loading = true;
    try {
      const loadedThree = await import("three");
      if (destroyed || !mountElement.isConnected) return;
      THREE = loadedThree;
      const created = createScene(THREE, Math.max(1, mountElement.clientWidth), Math.max(1, mountElement.clientHeight));
      scene = created.scene;
      camera = created.camera;
      renderer = created.renderer;
      model = created.model;
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional view of the AgroFlow field controller and connected sensors");
      renderer.domElement.setAttribute("aria-describedby", "hardwareComponentInfo");
      mountElement.append(renderer.domElement);
      viewerElement.classList.add("is-ready");
      viewerElement.setAttribute("aria-busy", "false");
      setActiveStory(reducedMotion.matches ? 2 : Math.round(progress));
      updateFocus();
      resizeObserver.observe(mountElement);
      resize();
    } catch (error) {
      console.warn("AgroFlow hardware visualisation could not start; using the static fallback.", error);
      viewerElement.classList.add("is-fallback");
      viewerElement.setAttribute("aria-busy", "false");
    }
  }

  const loadObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    loadObserver.disconnect();
    void loadViewer();
  }, { rootMargin: "700px 0px" });
  loadObserver.observe(section);

  window.addEventListener("scroll", syncStory, { passive: true, signal: abort.signal });
  reducedMotion.addEventListener("change", syncStory, { signal: abort.signal });

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    abort.abort();
    loadObserver.disconnect();
    activityObserver.disconnect();
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    if (frameRequest) window.cancelAnimationFrame(frameRequest);
    if (scene && renderer && model) disposeScene(scene, renderer, model.textures);
    scene = null;
    camera = null;
    renderer = null;
    model = null;
    THREE = null;
  }

  const mutationObserver = new MutationObserver(() => {
    if (!viewerElement.isConnected) destroy();
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
  syncStory();
}
