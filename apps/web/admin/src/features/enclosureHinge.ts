// Critically damped constrained hinge. Retains velocity on reversal and never
// leaves the physical [closed, open] range. Positive opening is outward (-Y).
export const ENCLOSURE_OPEN_RADIANS = -2.05;
export function stepHinge(value: number, velocity: number, target: number, dt: number) {
  const omega = 14;
  const elapsed = Math.max(0, Math.min(dt, 0.05));
  const displacement = value - target;
  const temporary = (velocity + omega * displacement) * elapsed;
  const decay = Math.exp(-omega * elapsed);
  const next = target + (displacement + temporary) * decay;
  const clamped = Math.max(0, Math.min(1, next));
  return { value: clamped, velocity: next === clamped ? (velocity - omega * temporary) * decay : 0 };
}
