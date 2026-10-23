import type { Camera, Material, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { ENCLOSURE_OPEN_RADIANS, stepHinge } from './enclosureHinge';
import { text as t } from '@/pages/publicCopy';
import {
  adaptivePixelRatio,
  createHardwareScene,
  disposeHardwareScene,
  type ComponentKey,
  type HardwareModel,
} from "@/features/hardwareModel";

type ThreeModule = typeof import("three");

interface StoryFrame {
  rotation: number;
  lidOpen: number;
  cameraZ: number;
  cameraX: number;
  targetX: number;
}

const COMPONENT_COPY: Record<ComponentKey, { title: string; body: string }> = {
  esp32: {
    title: "ESP32 Controller",
    body: "Reads the field sensors on GPIO 32 and 27, connects over Wi-Fi and executes safe irrigation commands.",
  },
  soil: {
    title: "Soil Moisture Sensor",
    body: "The YL-69 resistive probe sits in the crop root zone and reports moisture through its mounted interface board.",
  },
  dht: {
    title: "Temperature & Humidity Sensor",
    body: "A ventilated external DHT11 measures the crop-zone air without being sealed inside the enclosure.",
  },
  relay: {
    title: "5 V Relay Module",
    body: "The securely mounted relay isolates the ESP32 control signal and switches the configured pump output.",
  },
  pump: {
    title: "Pump / Irrigation Output",
    body: "An electrical control lead runs beside the irrigation pipe toward the pump or valve; water never enters the enclosure.",
  },
  power: {
    title: "Power Input",
    body: "A separate lower gland brings the controller's low-voltage supply to the protected terminal strip.",
  },
};

const STORY_FRAMES: StoryFrame[] = [
  { rotation: -0.24, lidOpen: 0, cameraZ: 14.6, cameraX: 0.35, targetX: 0 },
  { rotation: 0.30, lidOpen: 0, cameraZ: 14.7, cameraX: -0.10, targetX: 0 },
  { rotation: 0.10, lidOpen: 1, cameraZ: 18.1, cameraX: -0.70, targetX: -1.10 },
  { rotation: -0.05, lidOpen: 1, cameraZ: 18.1, cameraX: -0.85, targetX: -1.10 },
  { rotation: 0.10, lidOpen: 1, cameraZ: 18.0, cameraX: -0.65, targetX: -1.05 },
  { rotation: -0.10, lidOpen: 0.92, cameraZ: 18.0, cameraX: -0.70, targetX: -1.00 },
];

const EXTERNAL_COMPONENTS: ComponentKey[] = ["soil", "dht", "pump", "power"];
const ALL_COMPONENTS: ComponentKey[] = ["esp32", "relay", "soil", "dht", "pump", "power"];
const HOTSPOTS_BY_STAGE: ComponentKey[][] = [
  [],
  EXTERNAL_COMPONENTS,
  ALL_COMPONENTS,
  ["soil", "dht", "esp32"],
  ["esp32", "relay", "pump"],
  ALL_COMPONENTS,
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
    targetX: mix(a.targetX, b.targetX, amount),
  };
}

/**
 * Mount the scroll-led hardware story. Three.js remains a lazy chunk and the
 * renderer sleeps off-screen; the procedural model adds no large GLTF fetch.
 */
export function initHardwareShowcase(root: HTMLElement): void {
  const section = root.querySelector<HTMLElement>("[data-hardware-showcase]");
  const viewer = root.querySelector<HTMLElement>("[data-hardware-viewer]");
  const canvasMount = root.querySelector<HTMLElement>("[data-hardware-canvas]");
  const info = root.querySelector<HTMLElement>("#hardwareComponentInfo");
  if (!section || !viewer || !canvasMount || !info || viewer.dataset["initialized"] === "true") return;
  viewer.dataset["initialized"] = "true";
  const viewerElement: HTMLElement = viewer;
  const mountElement: HTMLElement = canvasMount;
  const infoElement: HTMLElement = info;

  const stages = Array.from(section.querySelectorAll<HTMLElement>("[data-hardware-stage]"));
  const hotspotButtons = new Map<ComponentKey, HTMLButtonElement>();
  section.querySelectorAll<HTMLButtonElement>("[data-hardware-hotspot]").forEach((button) => {
    const key = button.dataset["hardwareHotspot"] as ComponentKey | undefined;
    if (key && key in COMPONENT_COPY) hotspotButtons.set(key, button);
  });
  const toggleButton = section.querySelector<HTMLButtonElement>("[data-hardware-toggle]");

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
  let renderedLidOpen = 0;
  let lidOverride: 0 | 1 | null = null;
  let lidAnimation: { to: 0 | 1; lastAt: number } | null = null;
  let lidVelocity = 0;
  let dragStart: { pointerId: number; x: number; y: number; rotation: number; horizontal: boolean } | null = null;

  function setActiveStory(nextStage: number): void {
    activeStage = clamp(nextStage, 0, stages.length - 1);
    stages.forEach((stage, index) => stage.classList.toggle("is-active", index === activeStage));
  }

  function readStoryProgress(): number {
    if (reducedMotion.matches) return 0;
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
    return !reducedMotion.matches && visible && (lidAnimation !== null || activeStage === 3 || activeStage === 4);
  }

  function visibleHotspots(): ComponentKey[] {
    if (renderedLidOpen > 0.68) {
      if (lidOverride === 1 && activeStage < 2) return ALL_COMPONENTS;
      return HOTSPOTS_BY_STAGE[activeStage] ?? ALL_COMPONENTS;
    }
    return EXTERNAL_COMPONENTS;
  }

  function updateHotspots(): void {
    if (!model || !camera) return;
    const bounds = viewerElement.getBoundingClientRect();
    const visibleKeys = visibleHotspots();
    const point = model.root.position.clone();
    hotspotButtons.forEach((button, key) => {
      const show = visibleKeys.includes(key);
      button.hidden = !show;
      if (!show) return;
      const anchor = renderedLidOpen > 0.68 ? model!.openAnchors[key] ?? model!.anchors[key] : model!.anchors[key];
      anchor.getWorldPosition(point);
      point.project(camera! as Camera);
      const horizontalPadding = bounds.width < 560 ? 54 : 72;
      const footerSpace = bounds.width < 560 ? 142 : 126;
      const x = clamp((point.x * 0.5 + 0.5) * bounds.width, horizontalPadding, Math.max(horizontalPadding, bounds.width - horizontalPadding));
      button.style.left = `${x}px`;
      button.style.top = `${clamp((-point.y * 0.5 + 0.5) * bounds.height, 32, Math.max(32, bounds.height - footerSpace))}px`;
      button.classList.toggle("is-label-left", x > bounds.width * 0.61);
    });
  }

  function updateFocus(): void {
    if (!model) return;
    const focus: ComponentKey[] = activeStage === 3
      ? ["soil", "dht", "esp32"]
      : activeStage === 4 ? ["esp32", "relay", "pump"] : [];
    Object.entries(model.componentMaterials).forEach(([key, materials]) => {
      const dimmed = focus.length > 0 && !focus.includes(key as ComponentKey);
      materials.forEach((material: Material) => {
        material.transparent = dimmed;
        material.opacity = dimmed ? 0.34 : 1;
        material.depthWrite = !dimmed;
      });
    });
    model.senseSignal.visible = activeStage === 3;
    model.actSignal.visible = activeStage === 4;
    model.waterDrops.forEach((drop) => { drop.visible = activeStage === 4; });
  }

  function updateOpenUi(open: boolean): void {
    viewerElement.classList.toggle("is-open", open);
    viewerElement.dataset["enclosureState"] = open ? "open" : "closed";
    if (!toggleButton) return;
    toggleButton.textContent = t('openEnclosure');
    toggleButton.disabled = open;
    const close = section?.querySelector<HTMLButtonElement>('[data-hardware-close]');
    if (close) { close.textContent = t('closeEnclosure'); close.disabled = !open; }
    const reset = section?.querySelector<HTMLButtonElement>('[data-hardware-reset]');
    if (reset) { reset.textContent = t('resetView'); reset.setAttribute('aria-label', t('resetView')); }
    toggleButton.setAttribute("aria-expanded", String(open));
  }

  function animateLid(to: 0 | 1): void {
    lidOverride = to;
    updateOpenUi(to === 1);
    lidAnimation = reducedMotion.matches ? null : { to, lastAt: performance.now() };
    if (reducedMotion.matches) { renderedLidOpen = to; lidVelocity = 0; }
    requestRender();
  }

  function applyStoryState(time: number): void {
    if (!model || !camera) return;
    const state = interpolateFrame(progress);
    if (reducedMotion.matches && lidAnimation) {
      renderedLidOpen = lidAnimation.to;
      lidVelocity = 0;
      lidAnimation = null;
    }
    if (lidAnimation) {
      const step = stepHinge(renderedLidOpen, lidVelocity, lidAnimation.to, (time - lidAnimation.lastAt) / 1000);
      lidAnimation.lastAt = time;
      renderedLidOpen = step.value;
      lidVelocity = step.velocity;
      if (Math.abs(renderedLidOpen - lidAnimation.to) < 0.0001 && Math.abs(lidVelocity) < 0.001) {
        renderedLidOpen = lidAnimation.to; lidVelocity = 0; lidAnimation = null;
      }
    } else {
      renderedLidOpen = lidOverride ?? state.lidOpen;
    }

    if (lidOverride === null) updateOpenUi(renderedLidOpen > 0.5);

    model.root.rotation.y = state.rotation + userRotation;
    model.lid.rotation.y = ENCLOSURE_OPEN_RADIANS * renderedLidOpen;
    viewerElement.dataset['hingeAngle'] = model.lid.rotation.y.toFixed(4);
    const manual = lidOverride !== null;
    const cameraOpen = manual ? renderedLidOpen : state.lidOpen;
    const openCameraZ = mountElement.clientWidth < 560 ? 27.0 : 24.5;
    const cameraZ = manual ? mix(STORY_FRAMES[0]!.cameraZ, openCameraZ, cameraOpen) : mix(state.cameraZ, Math.max(state.cameraZ, openCameraZ), cameraOpen);
    const cameraX = manual ? mix(STORY_FRAMES[0]!.cameraX, -0.75, cameraOpen) : state.cameraX;
    const targetX = manual ? mix(0, -1.35, cameraOpen) : mix(state.targetX, Math.min(state.targetX, -1.35), cameraOpen);
    camera.position.set(cameraX, 0.08 + 0.18 * cameraOpen, cameraZ);
    camera.lookAt(targetX, 0.08 + 0.22 * cameraOpen, 0);

    const pulse = (time * 0.00034) % 1;
    if (model.senseSignal.visible) model.sensePath.getPoint(pulse, model.sensePulse.position);
    if (model.actSignal.visible) model.actPath.getPoint(pulse, model.actPulse.position);
    model.waterDrops.forEach((drop, index) => {
      const fall = (pulse + index / model!.waterDrops.length) % 1;
      drop.position.set(4.14 + fall * 0.58, -3.49 - fall * 0.24, -0.38);
      if (!Array.isArray(drop.material)) drop.material.opacity = 0.68 * (1 - fall);
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
    const nextStage = reducedMotion.matches ? 0 : Math.round(progress);
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
    renderer.setPixelRatio(adaptivePixelRatio(width));
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

  function resetView(): void {
    userRotation = 0;
    hotspotButtons.forEach((button) => {
      button.classList.remove("is-selected");
      button.setAttribute("aria-pressed", "false");
    });
    infoElement.innerHTML = "<strong>Explore the controller</strong><span>Select a component marker to learn what it does.</span>";
    animateLid(0);
  }

  hotspotButtons.forEach((button, key) => {
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => selectComponent(key), { signal: abort.signal });
  });
  toggleButton?.addEventListener("click", () => animateLid(1), { signal: abort.signal });
  section.querySelector<HTMLButtonElement>('[data-hardware-close]')?.addEventListener('click', () => animateLid(0), { signal: abort.signal });
  section.querySelector<HTMLButtonElement>("[data-hardware-rotate='left']")?.addEventListener("click", () => {
    userRotation -= 0.24;
    requestRender();
  }, { signal: abort.signal });
  section.querySelector<HTMLButtonElement>("[data-hardware-rotate='right']")?.addEventListener("click", () => {
    userRotation += 0.24;
    requestRender();
  }, { signal: abort.signal });
  section.querySelector<HTMLButtonElement>("[data-hardware-reset]")?.addEventListener("click", resetView, { signal: abort.signal });

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
    userRotation = dragStart.rotation + dx * 0.007;
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
      const created = createHardwareScene(THREE, Math.max(1, mountElement.clientWidth), Math.max(1, mountElement.clientHeight));
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
      setActiveStory(reducedMotion.matches ? 0 : Math.round(progress));
      updateFocus();
      updateOpenUi(false);
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
    if (scene && renderer && model) disposeHardwareScene(scene, renderer, model.textures);
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
