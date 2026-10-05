/* Picking a farm's coordinates on a map.
 *
 * WHY A MAP AND NOT TWO NUMBER FIELDS
 * farm.latitude/longitude (migration 0010) is what the weather lookup and the
 * FAO-56 engine read. Typed by hand it was routinely wrong: a dropped minus
 * sign puts a Western Cape farm in Kazakhstan, and nothing downstream
 * complains - the farmer simply gets somebody else's weather. Clicking the
 * spot cannot produce a transposed or sign-flipped coordinate.
 *
 * WHY LEAFLET COMES FROM A CDN AND NOT package.json
 * The brief allows exactly one new npm dependency and that is spent on
 * exceljs. Leaflet is loaded on demand instead, the first time a map step
 * actually opens - which also keeps it out of the main bundle, where it would
 * sit unused on every other page of the console.
 *
 * If the CDN is unreachable the caller gets a plain-language failure and the
 * two number fields remain usable, so a farm can still be registered on a
 * connection that cannot fetch a tile server.
 */

const LEAFLET_VERSION = "1.9.4";
const LEAFLET_CSS = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}/leaflet.min.css`;
const LEAFLET_JS = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}/leaflet.min.js`;

/* Roughly the middle of South Africa, zoomed out far enough that every
   province is on screen. A map that opens on Null Island asks the admin to
   find their own country first. */
const DEFAULT_CENTRE: [number, number] = [-28.5, 24.7];
const DEFAULT_ZOOM = 5;

/* Leaflet is not typed here - there is no @types/leaflet without adding a
   dependency - so the handful of methods used are declared narrowly instead
   of reaching for `any` across the file. */
type LeafletMarker = {
  setLatLng(latlng: [number, number]): LeafletMarker;
  getLatLng(): { lat: number; lng: number };
  addTo(map: LeafletMap): LeafletMarker;
  on(event: string, handler: () => void): LeafletMarker;
};

type LeafletMap = {
  setView(centre: [number, number], zoom: number): LeafletMap;
  on(event: string, handler: (e: { latlng: { lat: number; lng: number } }) => void): LeafletMap;
  invalidateSize(): void;
  remove(): void;
};

type LeafletGlobal = {
  map(el: HTMLElement, options?: Record<string, unknown>): LeafletMap;
  tileLayer(url: string, options?: Record<string, unknown>): { addTo(map: LeafletMap): unknown };
  marker(latlng: [number, number], options?: Record<string, unknown>): LeafletMarker;
};

declare global {
  interface Window {
    L?: LeafletGlobal;
  }
}

let loader: Promise<LeafletGlobal> | null = null;

/* One load per session, shared by every caller. The promise itself is the
   cache, so two map steps opening at once do not fetch the script twice. */
function loadLeaflet(): Promise<LeafletGlobal> {
  if (window.L) return Promise.resolve(window.L);
  if (loader) return loader;

  loader = new Promise<LeafletGlobal>((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
    }

    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;

    script.addEventListener("load", () => {
      if (window.L) resolve(window.L);
      else reject(new Error("The map library loaded but did not start."));
    });

    script.addEventListener("error", () => {
      // Reset, so a later attempt on a better connection can retry rather
      // than being handed this same rejected promise forever.
      loader = null;
      reject(new Error("The map could not be loaded. Type the coordinates instead."));
    });

    document.head.appendChild(script);
  });

  return loader;
}

export type LocationPickerHandle = {
  destroy(): void;
};

/* The markup for a map step. Rendered first, filled by mountLocationPicker.
 *
 * The two number fields are not a fallback bolted on - they are the values
 * being edited. The map writes into them and reads from them, so whichever
 * way the admin prefers to work, there is one source of truth and the review
 * step shows the same numbers that get saved. */
export function locationPickerHtml(opts: {
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
}): string {
  const lat = opts.latitude ?? "";
  const lng = opts.longitude ?? "";
  const id = opts.name ?? "farmLocation";

  return `
    <div class="map-pick" data-map-pick="${id}">
      <p class="muted">
        Click the farm's position on the map, or drag the pin. You can also type the
        coordinates if you have them.
      </p>

      <div class="map-pick-canvas" data-map-canvas aria-label="Farm location map"></div>
      <p class="map-pick-status" data-map-status hidden role="status"></p>

      <div class="map-pick-fields">
        <label class="f">
          Latitude
          <input
            type="number"
            step="0.00001"
            min="-90"
            max="90"
            data-field="latitude"
            data-map-lat
            value="${lat}"
            placeholder="-33.37"
          />
        </label>
        <label class="f">
          Longitude
          <input
            type="number"
            step="0.00001"
            min="-180"
            max="180"
            data-field="longitude"
            data-map-lng
            value="${lng}"
            placeholder="19.31"
          />
        </label>
      </div>
    </div>`;
}

/* Brings the map in the given container to life. Safe to call on a container
   that is currently hidden (a wizard step not yet reached): Leaflet is told
   to re-measure when the step becomes visible, which is what invalidateSize
   is for - without it the map renders as a grey box at zero height. */
export async function mountLocationPicker(
  container: HTMLElement,
): Promise<LocationPickerHandle> {
  const canvas = container.querySelector<HTMLElement>("[data-map-canvas]");
  const latInput = container.querySelector<HTMLInputElement>("[data-map-lat]");
  const lngInput = container.querySelector<HTMLInputElement>("[data-map-lng]");
  const status = container.querySelector<HTMLElement>("[data-map-status]");

  const say = (message: string | null): void => {
    if (!status) return;
    status.textContent = message ?? "";
    status.hidden = message === null;
  };

  if (!canvas || !latInput || !lngInput) {
    return { destroy: () => undefined };
  }

  say("Loading the map…");

  let L: LeafletGlobal;
  try {
    L = await loadLeaflet();
  } catch (error) {
    canvas.hidden = true;
    say(error instanceof Error ? error.message : "The map could not be loaded.");
    return { destroy: () => undefined };
  }

  say(null);

  const existing = (): [number, number] | null => {
    const lat = Number(latInput.value);
    const lng = Number(lngInput.value);
    if (!latInput.value || !lngInput.value) return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
  };

  const start = existing();
  const map = L.map(canvas, { scrollWheelZoom: true });
  map.setView(start ?? DEFAULT_CENTRE, start ? 13 : DEFAULT_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    // Required by the OpenStreetMap tile usage policy.
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  let marker: LeafletMarker | null = null;

  const place = (lat: number, lng: number, writeFields: boolean): void => {
    if (marker) {
      marker.setLatLng([lat, lng]);
    } else {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);

      // Dragging the pin is the fine adjustment after the first click, so it
      // has to write the fields too - otherwise the review step shows where
      // the admin first clicked, not where they left the pin.
      marker.on("dragend", () => {
        const at = marker?.getLatLng();
        if (at) place(at.lat, at.lng, true);
      });
    }

    if (writeFields) {
      // Five decimals is about a metre - more than enough for a farm, and it
      // keeps the review step readable.
      latInput.value = lat.toFixed(5);
      lngInput.value = lng.toFixed(5);
      latInput.dispatchEvent(new Event("input", { bubbles: true }));
      lngInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    say(`Pin at ${lat.toFixed(5)}, ${lng.toFixed(5)}.`);
  };

  if (start) place(start[0], start[1], false);

  map.on("click", (e) => place(e.latlng.lat, e.latlng.lng, true));

  // Typing stays authoritative: a pasted pair of coordinates moves the pin.
  const fromFields = (): void => {
    const next = existing();
    if (next) {
      place(next[0], next[1], false);
      map.setView(next, 13);
    }
  };

  latInput.addEventListener("change", fromFields);
  lngInput.addEventListener("change", fromFields);

  // The step may still have been display:none when the map was built.
  window.setTimeout(() => map.invalidateSize(), 60);

  return {
    destroy: () => {
      try {
        map.remove();
      } catch {
        // Already torn down with the drawer's innerHTML - nothing to do.
      }
    },
  };
}
