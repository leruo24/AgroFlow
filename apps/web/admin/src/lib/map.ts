/* Leaflet farm-location picker. Decimal coordinates are the authoritative
 * values; search, DMS input, the marker and reverse geocoding all synchronise
 * with those same two fields. */
import { formatDecimal, formatDms, parseCoordinatePair, validCoordinates } from "@/lib/coordinates";
import { plainError } from "@/lib/plainError";
import { reverseLocation, searchLocations, type LocationSearchResult } from "@/services/agroFlowApi";

const LEAFLET_VERSION = "1.9.4";
const LEAFLET_CSS = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}/leaflet.min.css`;
const LEAFLET_JS = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}/leaflet.min.js`;
const DEFAULT_CENTRE: [number, number] = [-28.5, 24.7];
const DEFAULT_ZOOM = 5;

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

declare global { interface Window { L?: LeafletGlobal; } }
let loader: Promise<LeafletGlobal> | null = null;

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
    script.addEventListener("load", () => window.L
      ? resolve(window.L)
      : reject(new Error("The map library loaded but did not start.")));
    script.addEventListener("error", () => {
      loader = null;
      reject(new Error("The map could not be loaded. Type the coordinates instead."));
    });
    document.head.appendChild(script);
  });
  return loader;
}

export type LocationPickerHandle = { destroy(): void };

export function locationPickerHtml(opts: {
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
}): string {
  const lat = opts.latitude ?? "";
  const lng = opts.longitude ?? "";
  const id = opts.name ?? "farmLocation";
  const pair = typeof lat === "number" && typeof lng === "number" ? formatDecimal(lat, lng) : "";
  return `<section class="map-pick" data-map-pick="${id}" aria-labelledby="${id}-title">
    <h4 id="${id}-title">Farm location</h4>
    <p class="muted">Search for a town, village, farm or district; choose the point on the map; or enter precise coordinates. A street address is not required.</p>
    <form class="map-search" data-map-search>
      <label class="f">Place or address
        <span class="map-search-row"><input type="search" data-map-query autocomplete="off" placeholder="e.g. Sesobe, North West" /><button type="submit" class="btn secondary">Search</button></span>
      </label>
    </form>
    <div class="map-search-results" data-map-results role="listbox" aria-label="Location search results" hidden></div>
    <div class="map-pick-canvas" data-map-canvas role="application" aria-label="Farm location map. Click to place the marker or drag the marker to adjust it."></div>
    <p class="map-pick-status" data-map-status hidden role="status"></p>
    <div class="map-place" data-map-place hidden>
      <b data-map-locality></b><span data-map-region></span>
      <span data-map-dms></span><small data-map-decimal></small>
    </div>
    <label class="f">Coordinates (decimal or DMS)
      <input type="text" data-map-pair value="${pair}" placeholder="-25.037, 26.434 or 25° 02′ 13″ S, 26° 26′ 02″ E" />
    </label>
    <div class="map-pick-fields">
      <label class="f">Latitude<input type="number" step="any" min="-90" max="90" data-field="latitude" data-map-lat value="${lat}" placeholder="-25.037" /></label>
      <label class="f">Longitude<input type="number" step="any" min="-180" max="180" data-field="longitude" data-map-lng value="${lng}" placeholder="26.434" /></label>
    </div>
  </section>`;
}

export async function mountLocationPicker(container: HTMLElement): Promise<LocationPickerHandle> {
  const canvas = container.querySelector<HTMLElement>("[data-map-canvas]");
  const latInput = container.querySelector<HTMLInputElement>("[data-map-lat]");
  const lngInput = container.querySelector<HTMLInputElement>("[data-map-lng]");
  const pairInput = container.querySelector<HTMLInputElement>("[data-map-pair]");
  const searchForm = container.querySelector<HTMLFormElement>("[data-map-search]");
  const queryInput = container.querySelector<HTMLInputElement>("[data-map-query]");
  const results = container.querySelector<HTMLElement>("[data-map-results]");
  const status = container.querySelector<HTMLElement>("[data-map-status]");
  const placeBox = container.querySelector<HTMLElement>("[data-map-place]");
  const locality = container.querySelector<HTMLElement>("[data-map-locality]");
  const region = container.querySelector<HTMLElement>("[data-map-region]");
  const dms = container.querySelector<HTMLElement>("[data-map-dms]");
  const decimal = container.querySelector<HTMLElement>("[data-map-decimal]");
  const locationInput = (container.closest("[data-wizard]") ?? container.closest(".drawer"))
    ?.querySelector<HTMLInputElement>('[data-field="location"]');
  if (!canvas || !latInput || !lngInput || !pairInput) return { destroy: () => undefined };

  const say = (message: string | null): void => {
    if (!status) return;
    status.textContent = message ?? "";
    status.hidden = message === null;
  };
  const current = (): [number, number] | null => {
    if (!latInput.value || !lngInput.value) return null;
    const lat = Number(latInput.value);
    const lng = Number(lngInput.value);
    return validCoordinates(lat, lng) ? [lat, lng] : null;
  };
  const showCoordinates = (lat: number, lng: number): void => {
    if (placeBox) placeBox.hidden = false;
    if (dms) dms.textContent = formatDms(lat, lng);
    if (decimal) decimal.textContent = `Decimal: ${formatDecimal(lat, lng)}`;
  };
  const showLocality = (name: string | null, detail: string | null): void => {
    if (locality) locality.textContent = name ?? "Selected coordinates";
    if (region) region.textContent = detail ?? "";
    if (name && locationInput) {
      locationInput.value = [name, detail].filter(Boolean).join(", ");
      locationInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  let reverseSequence = 0;
  const describe = async (lat: number, lng: number): Promise<void> => {
    const sequence = ++reverseSequence;
    try {
      const found = await reverseLocation(lat, lng);
      if (sequence !== reverseSequence) return;
      const detail = [found.district, found.province].filter(Boolean).join(", ") || found.country;
      showLocality(found.locality, detail || null);
    } catch {
      if (sequence !== reverseSequence) return;
      showLocality(null, "Nearest locality unavailable; your precise coordinates are still saved.");
    }
  };

  say("Loading the map…");
  let L: LeafletGlobal | null = null;
  try {
    L = await loadLeaflet();
  } catch (error) {
    canvas.hidden = true;
    say(plainError(error, "The map could not be loaded."));
  }

  const start = current();
  let map: LeafletMap | null = null;
  let marker: LeafletMarker | null = null;
  if (L) {
    say(null);
    map = L.map(canvas, { scrollWheelZoom: true });
    map.setView(start ?? DEFAULT_CENTRE, start ? 13 : DEFAULT_ZOOM);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
  }

  const place = (lat: number, lng: number, writeFields: boolean, reverse = true): void => {
    if (!validCoordinates(lat, lng)) {
      say("Latitude must be -90 to 90 and longitude -180 to 180. Keep the latitude first.");
      return;
    }
    if (map && L) {
      if (marker) marker.setLatLng([lat, lng]);
      else {
        marker = L.marker([lat, lng], { draggable: true }).addTo(map);
        marker.on("dragend", () => {
          const at = marker?.getLatLng();
          if (at) place(at.lat, at.lng, true);
        });
      }
    }
    if (writeFields) {
      latInput.value = String(Number(lat.toFixed(7)));
      lngInput.value = String(Number(lng.toFixed(7)));
      pairInput.value = formatDecimal(lat, lng);
      latInput.dispatchEvent(new Event("input", { bubbles: true }));
      lngInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    showCoordinates(lat, lng);
    say(`Pin at ${formatDecimal(lat, lng)}.`);
    if (reverse) void describe(lat, lng);
  };

  if (start) place(start[0], start[1], false);
  map?.on("click", (e) => place(e.latlng.lat, e.latlng.lng, true));

  const fromFields = (): void => {
    const next = current();
    if (!next) return void say("Enter a valid latitude and longitude.");
    place(next[0], next[1], false);
    pairInput.value = formatDecimal(next[0], next[1]);
    map?.setView(next, 13);
  };
  latInput.addEventListener("change", fromFields);
  lngInput.addEventListener("change", fromFields);
  pairInput.addEventListener("change", () => {
    const parsed = parseCoordinatePair(pairInput.value);
    if (!parsed) return void say("Use latitude first, then longitude, in decimal or DMS format.");
    place(parsed.latitude, parsed.longitude, true);
    map?.setView([parsed.latitude, parsed.longitude], 13);
  });

  const selectResult = (item: LocationSearchResult): void => {
    showLocality(item.name, item.detail);
    place(item.latitude, item.longitude, true, false);
    map?.setView([item.latitude, item.longitude], 13);
    if (results) results.hidden = true;
  };
  searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = queryInput?.value.trim() ?? "";
    if (query.length < 2) return void say("Type at least two characters to search.");
    say("Searching for matching places…");
    if (results) results.hidden = true;
    void searchLocations(query).then((items) => {
      if (!results) return;
      results.replaceChildren();
      if (items.length === 0) return void say("No matching place was found. You can still enter coordinates or choose the map.");
      for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "map-search-result";
        button.setAttribute("role", "option");
        const title = document.createElement("b");
        title.textContent = item.name;
        const detail = document.createElement("span");
        detail.textContent = item.detail;
        button.append(title, detail);
        button.addEventListener("click", () => selectResult(item));
        results.appendChild(button);
      }
      results.hidden = false;
      say(`${items.length} matching ${items.length === 1 ? "place" : "places"}. Choose the intended location.`);
    }).catch((error) => say(plainError(error, "Location search is unavailable. Enter coordinates instead.")));
  });

  window.setTimeout(() => map?.invalidateSize(), 60);
  return { destroy: () => { try { map?.remove(); } catch { /* already removed */ } } };
}
