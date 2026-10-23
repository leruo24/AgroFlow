// AF-02: the advice is built in the farmer's language from the server's code; an unknown code
// falls back to the server's English and says so.
import { adviceText } from '@/lib/advice';

describe('advice in the farmer language', () => {
  const water = { kind: 'water', text: 'Water about 12 min this morning (about 18 L)', code: 'water.now.minutes', args: { minutes: '12', litres: '18' } };

  it('builds the sentence from the code and its numbers', () => {
    expect(adviceText('en', water)).toEqual({ text: 'Water about 12 min this morning (about 18 L)', english: false });
    expect(adviceText('af', water).text).toBe('Lei omtrent 12 min vanoggend water (omtrent 18 L)');
    expect(adviceText('tn', water).english).toBe(false);
  });

  it('names the day in the language', () => {
    expect(adviceText('af', { kind: 'soon', text: 'No watering today; next on Friday', code: 'soon.on', args: { date: '2026-10-30', weekday: '5' } }).text)
      .toBe('Geen natlei vandag nie; volgende op Vrydag');
  });

  it("says installer steps are the installer's", () => {
    expect(adviceText('en', { kind: 'setup', text: 'Finish setup: add the pump...', code: 'setup.next', args: { field: 'flow_rate' } }).text)
      .toContain('Your installer');
  });

  it('an older server (no code) or an unknown code shows the English, marked', () => {
    expect(adviceText('af', { kind: 'none', text: 'No watering needed today' })).toEqual({ text: 'No watering needed today', english: true });
    expect(adviceText('en', { kind: 'none', text: 'No watering needed today', code: 'brand.new' })).toEqual({ text: 'No watering needed today', english: false });
  });
});
