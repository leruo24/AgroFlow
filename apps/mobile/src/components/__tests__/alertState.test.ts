/// <reference types="jest" />

import { mergeSavedAlerts, mergeServerAlerts, type AlertStateEntry } from '@/lib/alertState';

type Alert = AlertStateEntry & { title: string };
const alert = (id: string, farmId = '1', read = false): Alert => ({ id, farmId, read, title: id });

describe('farmer alert reconciliation', () => {
  it('removes a server alert that the backend no longer returns', () => {
    const current = [alert('database-10'), alert('local-command'), alert('database-20', '2')];
    expect(mergeServerAlerts(current, [alert('database-11')], '1').map(x => x.id)).toEqual([
      'database-11',
      'local-command',
      'database-20',
    ]);
  });

  it('uses the server read state for database alerts', () => {
    const result = mergeServerAlerts([alert('database-10')], [alert('database-10', '1', true)], '1');
    expect(result[0].read).toBe(true);
  });

  it('does not re-add a stale cached alert after that farm loaded from the server', () => {
    const result = mergeSavedAlerts([], [alert('database-10'), alert('local-command')], new Set(['1']));
    expect(result.map(x => x.id)).toEqual(['local-command']);
  });

  it('keeps cached database alerts while there is no live answer', () => {
    expect(mergeSavedAlerts([], [alert('database-10')], new Set()).map(x => x.id)).toEqual(['database-10']);
  });
});
