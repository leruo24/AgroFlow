// Every word of in-app page help, in one file, keyed by screen.
//
// It lives here rather than inside each screen so that the copy can be reviewed
// and edited in one pass, by someone who does not read React.
//
// COPY RULES (same as the insight messages):
//   Plain words. No jargon - never Kc, ETo, ETc, depletion, evapotranspiration
//   or "coefficient". Say what the page shows and what the farmer can do on it,
//   in two to four short sentences. Friendly, not chatty.

export type HelpTopic = {
  readonly title: string;
  // Two to four short sentences, rendered as separate paragraphs. Readonly
  // because the content below is `as const` - nothing should mutate the copy.
  readonly body: readonly string[];
};

export const helpContent = {
  home: {
    title: 'Your farm at a glance',
    body: [
      "This is your farm at a glance. You can see today's weather, how moist your soil is, and any alerts.",
      'Tap a zone to see more about it.',
    ],
  },

  irrigation: {
    title: 'Watering your zones',
    body: [
      'This page lists every zone on your farm and whether it is watering right now.',
      'You can start or stop watering by hand, or let the system do it for you.',
      'Tap a zone to change its settings.',
    ],
  },

  alerts: {
    title: 'Things to look at',
    body: [
      'Anything that needs your attention shows up here: a pump that did not work, a sensor that stopped reporting, or soil that got too dry.',
      'Newest alerts are at the top. Tap one to see which zone it came from.',
    ],
  },

  history: {
    title: 'What happened before',
    body: [
      'A record of every watering: when it ran, for how long, and roughly how much water it used.',
      'Water amounts are estimates worked out from the pump running time. There is no water meter.',
    ],
  },

  settings: {
    title: 'Settings',
    body: [
      'Change how the app looks, choose which messages you get, and turn the page help and the raindrop helper on or off.',
      'These choices are saved on this phone.',
    ],
  },

  profile: {
    title: 'Your details',
    body: [
      'Your name, phone number and password.',
      'Keep your phone number up to date so we can reach you about your farm.',
    ],
  },

  zoneDetail: {
    title: 'About this zone',
    body: [
      'Everything about one zone: how moist the soil is, when it last watered, and what the app suggests you do next.',
      'You can water it by hand, set a watering timetable, or change when it should water on its own.',
    ],
  },

  farmRequests: {
    title: 'Asking for a new farm or zone',
    body: [
      'Use this to ask our team to set up a new farm or a new zone for you.',
      'Tell us where it is, roughly how big it is, and what you are growing. We will get back to you.',
      'You can see the status of anything you have already asked for.',
    ],
  },

  zoneInsights: {
    title: 'What we suggest',
    body: [
      "Today's suggestions for this zone, worked out from the weather, your crop and your soil readings.",
      'The most urgent ones are at the top. Tap one to clear it once you have dealt with it.',
      'These are suggestions only. Nothing here waters your crops by itself.',
    ],
  },

  zoneCalibration: {
    title: 'Teaching the sensor your soil',
    body: [
      'Every soil reads differently, so the sensor needs to learn what wet and dry look like in yours.',
      'Soak the soil, wait a day, and tap Save wet. Later, when the soil is properly dry, tap Save dry.',
      'Do the two steps on different days. Watering advice still works before you do this, but you will not see a moisture percentage.',
    ],
  },

  zoneResetRecommended: {
    title: 'Back to our recommended levels',
    body: [
      'This sets when the zone waters, and when it stops, back to what we recommend for your crop and soil.',
      'It only works once the crop, the soil type and the wet/dry setup are all done.',
      'Your own settings are replaced, so only use it if you want to start again.',
    ],
  },

  zoneHardware: {
    title: 'Your kit',
    body: [
      'This is the little box in your field: the sensor that reads your soil and the switch that runs your pump.',
      'It says whether the kit is talking to us right now, and whether each sensor is working. If the temperature sensor stops, we use the weather for your area instead and your watering carries on.',
      'Use Change WiFi if you got a new router or changed your WiFi password. Your watering keeps running while you do it.',
    ],
  },

  zoneSoil: {
    title: 'Soil type',
    body: [
      'Soil type changes how much water your soil holds and how often it needs watering. Pick the one that feels most like your soil.',
    ],
  },
} as const;

export type HelpScreen = keyof typeof helpContent;

export function helpFor(screen: HelpScreen): HelpTopic {
  return helpContent[screen];
}
