// The audit's shared cases (docs/audit/fixtures), the same files the server's AuditFixTests read,
// so the app and the API cannot drift apart on weather, areas or phone numbers.
import weatherCases from '../../../../../docs/audit/fixtures/weather-cases.json';
import areaCases from '../../../../../docs/audit/fixtures/area-cases.json';
import phoneCases from '../../../../../docs/audit/fixtures/phone-cases.json';
import { weatherStatus } from '@/lib/weatherStatus';
import { formatArea } from '@/lib/area';
import { normalisePhone } from '@/lib/phone';

const fixtures: Record<string, { cases: any[] }> = {
  'weather-cases.json': weatherCases, 'area-cases.json': areaCases, 'phone-cases.json': phoneCases,
};
const cases = (file: string) => fixtures[file].cases;

describe('audit fixtures', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');

  it.each(cases('weather-cases.json'))('weather: $name', c => {
    const status = weatherStatus(c.hasRow ? {
      precipitation_mm: c.precipitationMm,
      fetched_at: c.ageHours == null ? null : new Date(now - c.ageHours * 3600_000).toISOString(),
    } : null, now);
    expect(status.availability).toBe(c.availability);
    expect(status.rainExpected).toBe(c.rainExpected);
    expect(status.reason).toBe(c.reason);
    if (status.availability !== 'available') expect(status.rainExpected).toBeNull();
  });

  it.each(cases('area-cases.json'))('area: $hectares ha', c => {
    expect(formatArea(c.hectares)).toBe(c.text);
  });

  it.each(cases('phone-cases.json'))('phone: "$phone"', c => {
    expect(normalisePhone(c.phone) !== null).toBe(c.ok);
  });
});
