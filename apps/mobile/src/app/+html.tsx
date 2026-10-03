// The HTML shell for the WEB build only. Expo Router renders this on the
// server during `expo export --platform web`; it never runs on iOS or
// Android, and nothing here reaches the native apps.
//
// WHY IT EXISTS: to make the exported web build installable on an iPhone.
//
// An APK cannot install on iOS, and a real iOS build needs a paid Apple
// Developer account that this project does not have. The web app is the
// answer - but a plain web page is a browser tab, not an app. The manifest
// and the apple-* meta tags below are what turn "a website" into something a
// farmer taps Share -> "Add to Home Screen" on and then opens from their home
// screen, full screen, with the AgroFlow icon.
import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />

        {/* viewport-fit=cover so the app reaches under the iPhone's notch and
            home indicator once it is running from the home screen, rather
            than sitting in a letterbox. maximum-scale stops iOS zooming the
            whole page when a text input is focused, which on a form-heavy
            screen looks like the app jumping. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
        />

        <title>AgroFlow</title>
        <meta
          name="description"
          content="Smart irrigation for South African farmers: live soil moisture, 7-day forecast advice, automatic watering and alerts."
        />

        {/* ---- Installable on a home screen ---------------------------- */}
        {/* Relative so it works under any path - the site is served from a
            sub-path on GitHub Pages (/AgroFlow/app/), not the domain root. */}
        <link rel="manifest" href="manifest.json" />

        {/* iOS ignores the manifest's display mode and uses these instead.
            Without apple-mobile-web-app-capable the icon on the home screen
            opens Safari with its address bar, which is the thing that makes
            it feel like a bookmark rather than an app. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="AgroFlow" />
        <link rel="apple-touch-icon" href="icons/agroflow-192.png" />

        <meta name="theme-color" content="#184D35" />
        <link rel="icon" href="favicon.ico" />

        {/* Expo's own reset. Without it the web body does not scroll the way
            the native ScrollViews expect, and long screens are cut off. */}
        <ScrollViewStyleReset />

        {/* The background behind the app, before React paints and in the
            overscroll area. Inline because it has to apply before any
            stylesheet loads - the same reasoning as the admin's splash. */}
        <style dangerouslySetInnerHTML={{ __html: backgroundStyle }} />
      </head>

      <body>{children}</body>
    </html>
  );
}

// #184D35 is the app's navigation colour and the native splash background,
// so the web app opens on the same colour the Android one does. The dark-mode
// value matches the app's own dark background rather than pure black, which
// would show a seam against the first screen.
const backgroundStyle = `
body {
  background-color: #184D35;
}

@media (prefers-color-scheme: dark) {
  body {
    background-color: #0F2A1E;
  }
}
`;
