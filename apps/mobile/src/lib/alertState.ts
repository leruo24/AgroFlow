export type AlertStateEntry = {
  id: string;
  farmId: string;
  read: boolean;
};

const isDatabaseAlert = (alert: AlertStateEntry) => alert.id.startsWith('database-');

// Replace the selected farm's server-backed alerts with the server's current answer while
// keeping phone-only command notices and alerts cached for other farms. This is also what
// removes an alert after staff or an automatic rule resolves it on the backend.
export function mergeServerAlerts<T extends AlertStateEntry>(
  current: T[],
  incoming: T[],
  farmId: string,
): T[] {
  const existingById = new Map(current.map(alert => [alert.id, alert]));
  const incomingIds = new Set(incoming.map(alert => alert.id));

  return [
    ...incoming.map(alert => ({
      ...alert,
      // Server-backed read state is authoritative across devices. A phone-only alert keeps
      // its local read state if an equivalent entry is ever supplied by a fixture.
      read: isDatabaseAlert(alert) ? alert.read : existingById.get(alert.id)?.read ?? alert.read,
    })),
    ...current.filter(alert =>
      !incomingIds.has(alert.id)
      && (alert.farmId !== farmId || !isDatabaseAlert(alert))),
  ];
}

// AsyncStorage hydrates in parallel with the live dashboard request. If the live answer won
// that race, do not append an old database alert behind it. If the app is offline, the cached
// alert remains available until a live answer can replace it.
export function mergeSavedAlerts<T extends AlertStateEntry>(
  current: T[],
  saved: T[],
  farmsLoadedFromServer: ReadonlySet<string>,
): T[] {
  const savedById = new Map(saved.map(alert => [alert.id, alert]));
  const currentIds = new Set(current.map(alert => alert.id));

  return [
    ...current.map(alert => ({
      ...alert,
      read: isDatabaseAlert(alert) ? alert.read : savedById.get(alert.id)?.read ?? alert.read,
    })),
    ...saved.filter(alert =>
      !currentIds.has(alert.id)
      && !(isDatabaseAlert(alert) && farmsLoadedFromServer.has(alert.farmId))),
  ];
}
