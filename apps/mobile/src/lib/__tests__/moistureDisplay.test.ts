/// <reference types="jest" />
// See doubleSubmit.test.ts for why this reference is per file.

/* An uncalibrated soil reading is never shown with a %. */

import {
  averageSoilText,
  relativeMoisturePercent,
  soilReadingText,
} from '../moistureDisplay';

describe('soil readings on screen', () => {
  it('is a sensor reading, with no %, before the wet/dry setup', () => {
    const text = soilReadingText({ value: 612, calibrated: false, status: 'Online' }, 'No reading');
    expect(text).toBe('Sensor reading 612 (not yet set up)');
    expect(text).not.toContain('%');
  });

  it('is a percentage once set up', () => {
    expect(soilReadingText({ value: 41.6, calibrated: true, status: 'Online' }, 'No reading')).toBe('42%');
  });

  it('says so when the sensor is offline', () => {
    expect(soilReadingText({ value: 0, calibrated: true, status: 'Offline' }, 'Unavailable')).toBe('Unavailable');
  });

  it('matches the backend formula, including a probe that reads lower when wet', () => {
    // Wet 1200, dry 3000: 2100 is halfway.
    expect(relativeMoisturePercent(2100, 1200, 3000)).toBeCloseTo(50);
    // Clamped, the same as SoilWaterBalance.RelativeMoisturePercent.
    expect(relativeMoisturePercent(900, 1200, 3000)).toBe(100);
    expect(relativeMoisturePercent(3500, 1200, 3000)).toBe(0);
    expect(relativeMoisturePercent(2100, null, 3000)).toBeNull();
    expect(relativeMoisturePercent(2100, 3000, 3000)).toBeNull();
  });

  it('never averages a sensor number with a percentage', () => {
    expect(
      averageSoilText([
        { value: 40, calibrated: true, status: 'Online' },
        { value: 612, calibrated: false, status: 'Online' },
      ])
    ).toBe('40%');
    expect(averageSoilText([{ value: 612, calibrated: false, status: 'Online' }])).toBe('Sensor not set up');
    expect(averageSoilText([])).toBe('No reading');
  });
});
