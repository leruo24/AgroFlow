// Native map surface: Leaflet + OpenStreetMap tiles inside a WebView.
//
// WHY NOT react-native-maps
// On Android it renders through Google Maps, which needs an API key and a
// billing account. app.json has never carried one, so the map silently never
// loaded and FarmLocationMap's 12-second failure timer fired - every Android
// farmer saw "Map unavailable. Farm location is shown above." AgroFlow is not
// using Google Maps, so the dependency bought nothing and cost every Android
// user the feature.
//
// OpenStreetMap needs no key and no billing. The web surface
// (FarmMapSurface.tsx) already used OSM raster tiles; this brings native onto
// the same tiles, so both platforms now show the same map from the same
// source.
//
// OSM TILE USAGE POLICY
// Tiles come from tile.openstreetmap.org, a donated-resource service. Three
// things that policy requires, all deliberate below:
//   - an identifying User-Agent (applicationNameForUserAgent)
//   - visible attribution linking to the copyright page
//   - no bulk or offline downloading; only the tiles on screen are fetched,
//     and the card does not pan or scroll, so that is a handful per view.
import { useCallback, useState } from 'react';
import { WebView } from 'react-native-webview';
import { farmMapSurfaceStyles as styles } from '@/styles/farmMapSurfaceStyles';
import type { FarmMapSurfaceProps } from './FarmMapSurface';

// Matches the green used for navigation chrome elsewhere in the app.
const MARKER_COLOUR = '#184D35';

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

function buildMapHtml(
  latitude: number,
  longitude: number,
  zoom: number
): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="stylesheet" href="${LEAFLET_CSS}" />
    <style>
      html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; }
      /* The card is glanceable, not interactive - the +/- buttons in
         FarmLocationMap are the only zoom control, so Leaflet's own chrome
         would be a second, conflicting one. */
      .leaflet-control-zoom { display: none; }
      .leaflet-control-attribution { font-size: 10px; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="${LEAFLET_JS}"></script>
    <script>
      // Any failure in here (script blocked, Leaflet not reachable) must reach
      // React Native, otherwise the card sits blank until the 12-second timer
      // in FarmLocationMap gives up.
      function reportFailure(reason) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage('error:' + reason);
        }
      }

      window.onerror = function (message) {
        reportFailure(String(message));
        return true;
      };

      try {
        var map = L.map('map', {
          zoomControl: false,
          attributionControl: true,
          dragging: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false,
          touchZoom: false,
          tap: false
        }).setView([${latitude}, ${longitude}], ${zoom});

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        }).addTo(map);

        L.circleMarker([${latitude}, ${longitude}], {
          radius: 9,
          color: '${MARKER_COLOUR}',
          weight: 3,
          fillColor: '${MARKER_COLOUR}',
          fillOpacity: 0.45
        }).addTo(map);

        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage('ready');
        }
      } catch (error) {
        reportFailure(error && error.message ? error.message : 'map init failed');
      }
    </script>
  </body>
</html>`;
}

export default function FarmMapSurface({
  latitude,
  longitude,
  zoom,
  onFailure,
}: FarmMapSurfaceProps) {
  const [failed, setFailed] = useState(false);

  // Fires onFailure once per mount. Without the guard, a WebView that errors
  // repeatedly (or errors and then also posts an error message) would call
  // back several times; FarmLocationMap only needs telling once.
  const reportFailure = useCallback(() => {
    if (failed) return;
    setFailed(true);
    onFailure();
  }, [failed, onFailure]);

  // The zoom prop is already a Leaflet zoom level, but the conversion is
  // written out rather than assumed: the previous react-native-maps surface
  // expressed scale as a lat/long delta, and keeping the delta round trip
  // visible means that if anything upstream ever starts passing a delta
  // again, this is the one line to change rather than a silent mis-scale.
  // round(log2(360 / delta)) is the inverse of delta = 360 / 2^zoom.
  const delta = 360 / 2 ** zoom;
  const leafletZoom = Math.min(18, Math.max(3, Math.round(Math.log2(360 / delta))));

  return (
    <WebView
      style={styles.map}
      originWhitelist={['*']}
      source={{ html: buildMapHtml(latitude, longitude, leafletZoom) }}

      // OSM's tile usage policy requires a User-Agent that identifies the
      // application. A generic WebView UA risks the tiles being blocked.
      applicationNameForUserAgent="AgroFlow/1.0"

      // Glanceable card: the surrounding View owns scrolling, and the +/-
      // buttons own zoom.
      scrollEnabled={false}
      bounces={false}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}

      // No offline tile store: incognito keeps everything in the session, so
      // nothing is written to persistent storage and there is no prefetching
      // or bulk download. In-session caching is deliberately LEFT ON - OSM's
      // policy asks for caching to reduce load on a donated service, and
      // disabling it would re-request the same handful of tiles on every
      // re-render. Only the tiles on screen are ever fetched; the card does
      // not pan.
      incognito

      onError={reportFailure}
      onHttpError={reportFailure}
      onRenderProcessGone={reportFailure}
      onContentProcessDidTerminate={reportFailure}
      onMessage={(event) => {
        if (event.nativeEvent.data.startsWith('error:')) reportFailure();
      }}
    />
  );
}
