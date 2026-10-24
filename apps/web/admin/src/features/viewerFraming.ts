import type { Box3, PerspectiveCamera } from 'three';
import type { HardwareModel } from './hardwareModel';
import { ENCLOSURE_OPEN_RADIANS } from './enclosureHinge';
type Three = typeof import('three');

// Cache the complete attached assembly's swing/rotation envelope once. The camera
// never follows scroll or door motion, so the canvas and model do not jump/zoom.
export function hardwareEnvelope(THREE: Three, model: HardwareModel): Box3 {
  const envelope = new THREE.Box3();
  const rotation = model.root.rotation.y, door = model.lid.rotation.y;
  for (let turn = 0; turn < 24; turn++) for (let swing = 0; swing <= 8; swing++) {
    model.root.rotation.y = turn * Math.PI / 12;
    model.lid.rotation.y = swing / 8 * ENCLOSURE_OPEN_RADIANS;
    model.root.updateMatrixWorld(true);
    envelope.union(new THREE.Box3().setFromObject(model.root));
  }
  model.root.rotation.y = rotation; model.lid.rotation.y = door;
  model.root.updateMatrixWorld(true);
  return envelope;
}
export function fitHardwareCamera(THREE: Three, camera: PerspectiveCamera, envelope: Box3, width: number, height: number) {
  const center = envelope.getCenter(new THREE.Vector3());
  const size = envelope.getSize(new THREE.Vector3());
  camera.aspect = width / Math.max(1, height);
  const tangent = Math.tan(camera.fov * Math.PI / 360);
  const distance = size.z / 2 + Math.max(size.y / 2 / tangent, size.x / 2 / tangent / camera.aspect) * 1.13;
  camera.position.set(center.x, center.y, center.z + distance);
  camera.lookAt(center);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
}
