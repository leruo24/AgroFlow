/* Icon set - Lucide (lucide-static), the same icon family
   apps/mobile uses via lucide-react-native, so the two apps' iconography
   actually matches instead of coincidentally resembling each other.

   Pulled in as raw SVG source via Vite's ?raw import (each file is real,
   unmodified lucide-static output - not hand-copied path data, which
   would risk drifting from the real glyphs) rather than the `lucide`
   npm package's JS runtime, since this app has no DOM-framework and
   every icon here is used as a plain string already interpolated into
   template-literal HTML (see ui/components.ts's kpiCard, app/router.ts's
   NAV) - a static SVG string slots into that exact same pattern with no
   new rendering machinery. license: lucide-static is ISC, same as lucide.

   Keys are the icon's own identity (lucide's name, camelCased), not the
   first place it got used - the same glyph gets reused across several
   unrelated KPIs/contexts (e.g. Icon.circleCheck for "Active", "Completed"
   AND toast success), so naming by shape avoids a growing pile of
   same-icon aliases. */

import layoutDashboard from "lucide-static/icons/layout-dashboard.svg?raw";
import users from "lucide-static/icons/users.svg?raw";
import tractor from "lucide-static/icons/tractor.svg?raw";
import radio from "lucide-static/icons/radio.svg?raw";
import bell from "lucide-static/icons/bell.svg?raw";
import wrench from "lucide-static/icons/wrench.svg?raw";
import barChart from "lucide-static/icons/bar-chart.svg?raw";
import droplet from "lucide-static/icons/droplet.svg?raw";
import activity from "lucide-static/icons/activity.svg?raw";
import settings from "lucide-static/icons/settings.svg?raw";
import sprout from "lucide-static/icons/sprout.svg?raw";
import circleCheck from "lucide-static/icons/circle-check.svg?raw";
import circleX from "lucide-static/icons/circle-x.svg?raw";
import inbox from "lucide-static/icons/inbox.svg?raw";
import triangleAlert from "lucide-static/icons/triangle-alert.svg?raw";
import calendar from "lucide-static/icons/calendar.svg?raw";
import clock from "lucide-static/icons/clock.svg?raw";
import sparkles from "lucide-static/icons/sparkles.svg?raw";
import moon from "lucide-static/icons/moon.svg?raw";
import mapPin from "lucide-static/icons/map-pin.svg?raw";
import map from "lucide-static/icons/map.svg?raw";
import ruler from "lucide-static/icons/ruler.svg?raw";
import repeat from "lucide-static/icons/repeat.svg?raw";
import wifi from "lucide-static/icons/wifi.svg?raw";
import headphones from "lucide-static/icons/headphones.svg?raw";
import info from "lucide-static/icons/info.svg?raw";
import userX from "lucide-static/icons/user-x.svg?raw";
import hourglass from "lucide-static/icons/hourglass.svg?raw";
import timer from "lucide-static/icons/timer.svg?raw";
import pause from "lucide-static/icons/pause.svg?raw";
import menu from "lucide-static/icons/menu.svg?raw";
import x from "lucide-static/icons/x.svg?raw";

export const Icon = {
  layoutDashboard,
  users,
  tractor,
  radio,
  bell,
  wrench,
  barChart,
  droplet,
  activity,
  settings,
  sprout,
  circleCheck,
  circleX,
  inbox,
  triangleAlert,
  calendar,
  clock,
  sparkles,
  moon,
  mapPin,
  map,
  ruler,
  repeat,
  wifi,
  headphones,
  info,
  userX,
  hourglass,
  timer,
  pause,
  menu,
  x,
} as const;
