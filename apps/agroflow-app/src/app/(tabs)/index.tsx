// Home screen dashboard
import {
  router,
} from 'expo-router';

import {
  Droplet,
} from 'lucide-react-native';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  SafeAreaView,
} from 'react-native-safe-area-context';

import {
  useAgroFlow,
} from '@/context/AgroFlowContext';

import {
  useAuth,
} from '@/context/AuthContext';

import {
  useTheme,
} from '@/context/ThemeContext';

import {
  mockFarm,
} from '@/data/mockFarm';

import {
  createHomeStyles,
} from '@/styles/homeStyles';

type WeatherData = {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  rainChance: number;
  updatedAt: string;
};

export default function HomeScreen() {
  const {
    colors,
  } = useTheme();

  const {
    user,
  } = useAuth();

  const {
    zones,
    zonesLoading,
    zonesError,
    refreshZones,
    alerts,
  } = useAgroFlow();

  const profileInitials =
    [
      user?.firstName,
      user?.lastName,
    ]
      .filter(
        Boolean
      )
      .map(
        (name) =>
          name!
            .trim()
            .charAt(0)
      )
      .join('')
      .toUpperCase() ||
    'AF';

  const styles =
    useMemo(
      () =>
        createHomeStyles(
          colors
        ),
      [
        colors,
      ]
    );

  const [
    weather,
    setWeather,
  ] =
    useState<WeatherData | null>(
      null
    );

  const [
    weatherLoading,
    setWeatherLoading,
  ] =
    useState(true);

  const [
    weatherError,
    setWeatherError,
  ] =
    useState(false);

  useEffect(
    () => {
      let mounted =
        true;

      async function loadWeather() {
        try {
          setWeatherLoading(
            true
          );

          setWeatherError(
            false
          );
//A live weather API 
          const latitude = //takes coordinates of the farm from mockFarm data and takes them to open meteo requesting weather information
            mockFarm.location
              .latitude;

          const longitude =
            mockFarm.location
              .longitude;

          const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${latitude}` +
            `&longitude=${longitude}` +
            `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
            `&daily=precipitation_probability_max` +
            `&timezone=auto` +
            `&forecast_days=1`;

          const response =
            await fetch(
              url
            );

          if (
            !response.ok
          ) {
            throw new Error(
              'Weather request failed'
            );
          }

          const data =
            await response.json();

          if (
            !mounted
          ) {
            return;
          }

          const currentTime =
            data.current?.time ??
            '';
//converts the data from the API into a format that can be displayed on the home screen
//the api response is a lot of data this extracts the key information we need and sets it to the weather state variable
          setWeather({
            temperature:
              data.current
                ?.temperature_2m ??
              0,

            apparentTemperature:
              data.current
                ?.apparent_temperature ??
              0,

            humidity:
              data.current
                ?.relative_humidity_2m ??
              0,

            windSpeed:
              data.current
                ?.wind_speed_10m ??
              0,

            weatherCode:
              data.current
                ?.weather_code ??
              0,

            rainChance:
              data.daily
                ?.precipitation_probability_max
                ?.[0] ??
              0,

            updatedAt:
              currentTime.length >=
              16
                ? currentTime.slice(
                    11,
                    16
                  )
                : '',
          });
        } catch (
          error
        ) {
          console.log(
            'Weather error:',
            error
          );

          if (
            mounted
          ) {
            setWeatherError(
              true
            );
          }
        } finally {
          if (
            mounted
          ) {
            setWeatherLoading(
              false
            );
          }
        }
      }

      loadWeather();

      return () => {
        mounted =
          false;
      };
    },
    []
  );
// Calculates the average soil moisture, active zones, water used today,
// and unread alerts displayed on the Home screen.
  const averageMoisture =
    zones.length > 0
      ? Math.round(
          zones.reduce(
            (
              total,
              zone
            ) =>
              total +
              zone.sensors
                .soilMoisture
                .value,
            0
          ) /
            zones.length
        )
      : 0;

  const activeZones =
    zones.filter(
      (
        zone
      ) =>
        zone.irrigation
          .status ===
        'Active'
    ).length;

  const waterUsedToday =
    Math.round(
      zones.reduce(
        (
          total,
          zone
        ) =>
          total +
          zone.water
            .usedTodayLitres,
        0
      )
    );

  const unreadAlerts =
    alerts.filter(
      (
        alert
      ) =>
        !alert.read
    ).length;

  async function handleDashboard() {
    if (
      !mockFarm.dashboardUrl
    ) {
      return;
    }

    await Linking.openURL(
      mockFarm.dashboardUrl
    );
  }

  return (
    <SafeAreaView
      style={[
        styles.container,
        {
          backgroundColor:
            colors.navigation,
        },
      ]}
      edges={[
        'top',
      ]}
    >
      <ScrollView
        style={{
          backgroundColor:
            colors.background,
        }}
        showsVerticalScrollIndicator={
          false
        }
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: 0,
          },
        ]}
      >
        <View
          style={[
            styles.topBar,
            {
              minHeight: 50,
              marginHorizontal: -18,
              paddingHorizontal: 18,
              paddingTop: 4,
              paddingBottom: 4,
              backgroundColor:
                colors.navigation,
            },
          ]}
        >
          <View
            style={
              styles.brandRow
            }
          >
            <Droplet
              size={20}
              color={
                colors.primary
              }
              fill={
                colors.primary
              }
              strokeWidth={1.8}
            />

            <Text
              style={[
                styles.brand,
                {
                  fontSize: 19,
                  color:
                    colors.navigationText,
                },
              ]}
            >
              AgroFlow
            </Text>
          </View>

          <TouchableOpacity
            style={{
              position: 'relative',
              width: 38,
              height: 38,
              margin: 0,
              padding: 0,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              borderWidth: 2,
              borderRadius: 19,
              borderColor: colors.white,
              backgroundColor: colors.primary,
            }}
            onPress={() =>
              router.push(
                '/profile'
              )
            }
            activeOpacity={
              0.7
            }
          >
            <Text
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                margin: 0,
                padding: 0,
                fontSize: 12,
                fontWeight: '700',
                letterSpacing: 0,
                textAlign: 'center',
                textAlignVertical: 'center',
                includeFontPadding: false,
                color: colors.white,
              }}
            >{profileInitials}</Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.farmHeader,
            {
              paddingTop: 4,
              paddingBottom: 7,
            },
          ]}
        >
          <Text
            style={
              styles.farmName
            }
          >
            {
              mockFarm.name
            }
          </Text>

          <Text
            style={
              styles.farmLocation
            }
          >
            {
              mockFarm.location
                .city
            }
            {' • '}
            South Africa
          </Text>
        </View>

        <View
          style={
            styles.weatherHero
          }
        >
          {weatherLoading ? (
            <View
              style={
                styles.weatherMessage
              }
            >
              <Text
                style={
                  styles.weatherLoading
                }
              >
                Loading weather...
              </Text>
            </View>
          ) : weatherError ||
            !weather ? (
            <View
              style={
                styles.weatherMessage
              }
            >
              <Text
                style={
                  styles.weatherCity
                }
              >
                {
                  mockFarm.location
                    .city
                }
              </Text>

              <Text
                style={
                  styles.weatherUnavailable
                }
              >
                Weather unavailable
              </Text>
            </View>
          ) : (
            <>
              <View
                style={
                  styles.weatherHeader
                }
              >
                <Text
                  style={
                    styles.weatherCity
                  }
                >
                  {
                    mockFarm.location
                      .city
                  }
                </Text>

                <Text
                  style={
                    styles.updatedText
                  }
                >
                  {weather.updatedAt
                    ? `Updated ${weather.updatedAt}`
                    : ''}
                </Text>
              </View>

              <View
                style={
                  styles.weatherContent
                }
              >
                <View
                  style={
                    styles.weatherMain
                  }
                >
                  <Text
                    style={
                      styles.temperature
                    }
                  >
                    {Math.round(
                      weather.temperature
                    )}
                    °C
                  </Text>

                  <Text
                    style={
                      styles.condition
                    }
                  >
                    {getWeatherCondition(
                      weather.weatherCode
                    )}
                  </Text>

                  <Text
                    style={
                      styles.feelsLike
                    }
                  >
                    Feels like{' '}
                    {Math.round(
                      weather.apparentTemperature
                    )}
                    °C
                  </Text>
                </View>

                <View
                  style={
                    styles.weatherDetails
                  }
                >
                  <View
                    style={
                      styles.weatherDetailRow
                    }
                  >
                    <Text
                      style={
                        styles.weatherDetailLabel
                      }
                    >
                      Humidity
                    </Text>

                    <Text
                      style={
                        styles.weatherDetailValue
                      }
                    >
                      {Math.round(
                        weather.humidity
                      )}
                      %
                    </Text>
                  </View>

                  <View
                    style={
                      styles.weatherDetailRow
                    }
                  >
                    <Text
                      style={
                        styles.weatherDetailLabel
                      }
                    >
                      Wind
                    </Text>

                    <Text
                      style={
                        styles.weatherDetailValue
                      }
                    >
                      {Math.round(
                        weather.windSpeed
                      )}{' '}
                      km/h
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.weatherDetailRow,
                      styles.weatherDetailLast,
                    ]}
                  >
                    <Text
                      style={
                        styles.weatherDetailLabel
                      }
                    >
                      Rain chance
                    </Text>

                    <Text
                      style={
                        styles.weatherDetailValue
                      }
                    >
                      {Math.round(
                        weather.rainChance
                      )}
                      %
                    </Text>
                  </View>
                </View>
              </View>
            </>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.dashboardButton,
            {
              backgroundColor:
                colors.primary,
            },
          ]}
          onPress={
            handleDashboard
          }
          activeOpacity={
            0.75
          }
        >
          <Text
            style={[
              styles.dashboardButtonText,
              {
                color:
                  colors.white,
              },
            ]}
          >
            View Dashboard
          </Text>

          <Text
            style={[
              styles.dashboardArrow,
              {
                color:
                  colors.white,
              },
            ]}
          >
            ›
          </Text>
        </TouchableOpacity>

        <Text
          style={
            styles.sectionTitle
          }
        >
          Farm Status
        </Text>

        {zonesLoading ? (
          <View
            style={
              styles.statusCard
            }
          >
            <Text
              style={
                styles.statusLabel
              }
            >
              Loading zone data…
            </Text>
          </View>
        ) : zonesError ? (
          <View
            style={
              styles.statusCard
            }
          >
            <Text
              style={
                styles.statusLabel
              }
            >
              Unable to load zones
            </Text>

            <TouchableOpacity
              onPress={
                refreshZones
              }
              activeOpacity={
                0.7
              }
            >
              <Text
                style={[
                  styles.statusLabel,
                  {
                    marginTop: 6,
                    fontWeight: '700',
                    color:
                      colors.primary,
                  },
                ]}
              >
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View
            style={
              styles.statusGrid
            }
          >
            <View
              style={
                styles.statusCard
              }
            >
              <Text
                style={
                  styles.statusValue
                }
              >
                {
                  averageMoisture
                }
                %
              </Text>

              <Text
                style={
                  styles.statusLabel
                }
              >
                Avg Soil Moisture
              </Text>
            </View>

            <View
              style={
                styles.statusCard
              }
            >
              <Text
                style={
                  styles.statusValue
                }
              >
                {
                  activeZones
                }
              </Text>

              <Text
                style={
                  styles.statusLabel
                }
              >
                Active Zones
              </Text>
            </View>

            <View
              style={
                styles.statusCard
              }
            >
              <Text
                style={
                  styles.statusValue
                }
              >
                {
                  waterUsedToday.toLocaleString()
                }
                {' L'}
              </Text>

              <Text
                style={
                  styles.statusLabel
                }
              >
                Water Used Today
              </Text>
            </View>

            <View
              style={
                styles.statusCard
              }
            >
              <Text
                style={
                  styles.statusValue
                }
              >
                {
                  alerts.length
                }
              </Text>

              <Text
                style={
                  styles.statusLabel
                }
              >
                Active Alerts
              </Text>
            </View>
          </View>
        )}

        <Text
          style={
            styles.sectionTitle
          }
        >
          Quick Actions
        </Text>

        <View
          style={
            styles.actionGrid
          }
        >
          <TouchableOpacity
            style={[
              styles.actionCard,
              styles.actionCardAqua,
            ]}
            onPress={() =>
              router.push(
                '/irrigation'
              )
            }
            activeOpacity={
              0.75
            }
          >
            <Text
              style={
                styles.actionTitle
              }
            >
              Manage Irrigation
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionCard,
              styles.actionCardSage,
            ]}
            onPress={() =>
              router.push(
                '/alerts'
              )
            }
            activeOpacity={
              0.75
            }
          >
            <Text
              style={
                styles.actionTitle
              }
            >
              View Alerts
            </Text>

            {unreadAlerts >
              0 && (
              <View
                style={
                  styles.badge
                }
              >
                <Text
                  style={
                    styles.badgeText
                  }
                >
                  {
                    unreadAlerts
                  }
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionCard,
              styles.actionCardAqua,
            ]}
            onPress={() =>
              router.push(
                '/history'
              )
            }
            activeOpacity={
              0.75
            }
          >
            <Text
              style={
                styles.actionTitle
              }
            >
              View History
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionCard,
              styles.actionCardSage,
            ]}
            onPress={() =>
              router.push(
                '/settings'
              )
            }
            activeOpacity={
              0.75
            }
          >
            <Text
              style={
                styles.actionTitle
              }
            >
              Settings
            </Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function getWeatherCondition(
  code: number
) {
  if (
    code ===
    0
  ) {
    return 'Clear sky';
  }

  if (
    code ===
      1 ||
    code ===
      2
  ) {
    return 'Partly cloudy';
  }

  if (
    code ===
    3
  ) {
    return 'Cloudy';
  }

  if (
    code ===
      45 ||
    code ===
      48
  ) {
    return 'Foggy';
  }

  if (
    code >=
      51 &&
    code <=
      67
  ) {
    return 'Rain';
  }

  if (
    code >=
      71 &&
    code <=
      77
  ) {
    return 'Snow';
  }

  if (
    code >=
      80 &&
    code <=
      82
  ) {
    return 'Rain showers';
  }

  if (
    code >=
    95
  ) {
    return 'Thunderstorms';
  }

  return 'Cloudy';
}

