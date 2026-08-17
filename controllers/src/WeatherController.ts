// Moved from apps/web-dashboard/src/pages/Dashboard.jsx
// The two inline fetch() calls in the Dashboard component's useEffects are
// unchanged apart from taking the API keys as parameters instead of reading
// `import.meta.env` directly (that API is Vite-specific and doesn't exist in
// a shared package) and adding lat/lon/location params instead of the
// hardcoded Cape Town coordinates that were in the original.

export async function fetchCurrentWeather(
  apiKey: string,
  latitude: number,
  longitude: number
) {
  const res = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&units=metric&appid=${apiKey}`
  );

  return res.json();
}

export async function fetchSevenDayForecast(
  apiKey: string,
  location: string
) {
  const res = await fetch(
    `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(
      location
    )}&days=7`
  );

  const data = await res.json();
  return data.forecast?.forecastday ?? [];
}
