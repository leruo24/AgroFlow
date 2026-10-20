/// <reference types="jest" />
import { describeEvent } from '../eventText';
import { flowRateFromBottle, plantedWeeksAgo } from '../setupHelpers';

describe('Finish setup arithmetic (item 6)', () => {
  it('turns seconds to fill the marked flow-rate test bottle into litres a minute', () => {
    expect(flowRateFromBottle(15)).toBe(2);   // 0.5 / 15 x 60
    expect(flowRateFromBottle(30)).toBe(1);
    expect(flowRateFromBottle(7)).toBe(4.29);
    expect(flowRateFromBottle(0)).toBeNull();
    expect(flowRateFromBottle(Number.NaN)).toBeNull();
  });

  it('turns "about N weeks ago" into a date', () => {
    const today = new Date('2026-02-10T08:00:00Z');
    expect(plantedWeeksAgo(0, today)).toBe('2026-02-10');
    expect(plantedWeeksAgo(3, today)).toBe('2026-01-20');
    expect(plantedWeeksAgo(-1, today)).toBeNull();
    expect(plantedWeeksAgo(1.5, today)).toBeNull();
    expect(plantedWeeksAgo(105, today)).toBeNull();
  });
});

describe('History lines (item 6)', () => {
  it('labels a watering logged by hand and never calls it a pump run', () => {
    const byHand = describeEvent({ runtime_seconds: 0, estimated_litres: 12, logged_by_profile_id: 'abc' });
    expect(byHand.action).toBe('Watering logged by hand');
    expect(byHand.description).toBe('You logged watering about 12 L.');
    expect(byHand.source).toBe('Entered by hand');

    const timed = describeEvent({ runtime_seconds: 600, estimated_litres: null, logged_by_profile_id: 'abc' });
    expect(timed.description).toBe('You logged watering for about 10 minutes.');
  });

  it('leaves kit events as they were', () => {
    const kit = describeEvent({ runtime_seconds: 300, estimated_litres: 7.5, trigger_source: 'automatic' });
    expect(kit).toEqual({ action: 'Watering finished', description: 'The kit watered for 5 minutes and stopped.', source: 'automatic' });
    expect(describeEvent({ runtime_seconds: 60, trigger_source: 'manual' }).description).toBe('The kit watered for 1 minute and stopped.');
    expect(describeEvent({ runtime_seconds: 45, trigger_source: 'manual' }).description).toBe('The kit watered for 45 seconds and stopped.');
  });
});
