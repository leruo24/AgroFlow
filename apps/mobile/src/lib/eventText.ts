/* How one irrigation_event reads in the History tab.
 * A watering the farmer logged by hand (logged_by_profile_id, migration 0042) is labelled
 * as such, and shown in litres when that is what they entered, never as a pump run. */
export type EventTextInput = {
  runtime_seconds: number | string | null;
  estimated_litres?: number | string | null;
  trigger_source?: string | null;
  logged_by_profile_id?: string | null;
};

export function describeEvent(event: EventTextInput): { action: string; description: string; source: string } {
  const minutes = event.runtime_seconds == null ? null : Math.round(Number(event.runtime_seconds) / 60);
  const litres = event.estimated_litres == null ? null : Math.round(Number(event.estimated_litres));

  if (event.logged_by_profile_id) {
    const amount = minutes ? `for about ${minutes} minutes` : litres ? `about ${litres} L` : '';
    return {
      action: 'Watering logged by hand',
      description: amount ? `You logged watering ${amount}.` : 'You logged a watering.',
      source: 'Entered by hand',
    };
  }

  return {
    action: 'Irrigation recorded',
    description: minutes == null ? 'An irrigation event was recorded.' : `Irrigation ran for ${minutes} minutes.`,
    source: event.trigger_source || 'Irrigation',
  };
}
