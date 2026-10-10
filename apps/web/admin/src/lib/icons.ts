/* Icon set: Lucide (lucide-static), the same icons apps/mobile uses through
 * lucide-react-native. Imported as raw SVG with Vite's ?raw, because every icon here is a
 * plain string put into template-literal HTML (see ui/components.ts's kpiCard and
 * app/router.ts's NAV). lucide-static is ISC licensed.
 * Keys are the icon's own lucide name in camelCase, not where it is used, because one glyph
 * is reused in several places (e.g. Icon.circleCheck for "Active", "Completed" and toasts). */

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
