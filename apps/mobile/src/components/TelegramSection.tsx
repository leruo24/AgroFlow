//Lets a farmer connect their Telegram account from the profile screen.
//
//New farmers are linked on-site: the installer shows a QR code and the farmer
//scans it. This screen is the path for everyone else - farmers who were
//already in AgroFlow before the bot existed, and anyone who changed phone or
//disconnected. They are holding the phone already, so there is no QR code
//involved: tapping the button opens Telegram with the single-use code
//already in the link.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Linking,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { AppAlert as Alert } from '@/components/AppAlert';

import {
  useTheme,
} from '@/context/ThemeContext';

import {
  disconnectTelegram,
  fetchTelegramLinkStatus,
  requestTelegramLinkCode,
  setTelegramAlerts,
} from '@/services/agroFlowApi';

import {
  createProfileStyles,
} from '@/styles/profileStyles';

export function TelegramSection() {
  const {
    colors,
  } = useTheme();

  const styles =
    useMemo(
      () =>
        createProfileStyles(
          colors
        ),
      [
        colors,
      ]
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    linked,
    setLinked,
  ] =
    useState(false);

  const [
    alertsEnabled,
    setAlertsEnabled,
  ] =
    useState(true);

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState('');

  const loadStatus =
    useCallback(
      async () => {
        try {
          setError('');

          const status =
            await fetchTelegramLinkStatus();

          setLinked(
            status.linked
          );

          setAlertsEnabled(
            status.alertsEnabled
          );
        } catch (
          caughtError: unknown
        ) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Could not check your Telegram connection.'
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      []
    );

  useEffect(
    () => {
      void loadStatus();
    },
    [
      loadStatus,
    ]
  );

  async function handleConnect() {
    try {
      setBusy(
        true
      );

      setError('');

      const code =
        await requestTelegramLinkCode();

      if (
        !code.deepLink
      ) {
        throw new Error(
          'AgroFlow is not set up for Telegram yet.'
        );
      }

      const opened =
        await Linking.canOpenURL(
          code.deepLink
        );

      if (
        !opened
      ) {
        throw new Error(
          'Telegram does not seem to be installed on this phone.'
        );
      }

      await Linking.openURL(
        code.deepLink
      );

      //The link is only redeemed once the farmer actually presses Start
      //inside Telegram, which happens outside this app. Re-checking when
      //they come back is what turns this section green.
      Alert.alert(
        'Finish in Telegram',
        'Press Start in Telegram, then come back here and pull to refresh.'
      );
    } catch (
      caughtError: unknown
    ) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Could not start the Telegram connection.'
      );
    } finally {
      setBusy(
        false
      );
    }
  }

  function handleDisconnect() {
    Alert.alert(
      'Disconnect Telegram?',
      'AgroFlow will stop messaging you about your zones, your irrigation and your requests.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                setBusy(
                  true
                );

                await disconnectTelegram();

                setLinked(
                  false
                );
              } catch (
                caughtError: unknown
              ) {
                setError(
                  caughtError instanceof Error
                    ? caughtError.message
                    : 'Could not disconnect Telegram.'
                );
              } finally {
                setBusy(
                  false
                );
              }
            })();
          },
        },
      ]
    );
  }

  async function handleToggleAlerts(
    next: boolean
  ) {
    //Flip immediately so the switch feels responsive, then put it back if
    //the server disagrees.
    setAlertsEnabled(
      next
    );

    try {
      await setTelegramAlerts(
        next
      );
    } catch (
      caughtError: unknown
    ) {
      setAlertsEnabled(
        !next
      );

      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Could not change your alert setting.'
      );
    }
  }

  return (
    <>
      <Text
        style={
          styles.sectionTitle
        }
      >
        Telegram
      </Text>

      <View
        style={
          styles.sectionCard
        }
      >
        {loading ? (
          <View
            style={
              styles.infoRow
            }
          >
            <ActivityIndicator
              color={
                colors.primaryDark
              }
            />
          </View>
        ) : (
          <>
            <View
              style={
                styles.infoRow
              }
            >
              <Text
                style={
                  styles.infoLabel
                }
              >
                Status
              </Text>

              <Text
                style={
                  styles.infoValue
                }
              >
                {linked
                  ? 'Connected'
                  : 'Not connected'}
              </Text>
            </View>

            {linked && (
              <View
                style={
                  styles.infoRow
                }
              >
                <Text
                  style={
                    styles.infoLabel
                  }
                >
                  Alerts
                </Text>

                <Switch
                  value={
                    alertsEnabled
                  }
                  onValueChange={(
                    next
                  ) => {
                    void handleToggleAlerts(
                      next
                    );
                  }}
                  trackColor={{
                    true:
                      colors.primary,
                    false:
                      colors.border,
                  }}
                />
              </View>
            )}

            <View
              style={
                styles.lastInfoRow
              }
            >
              <Text
                style={
                  styles.infoLabel
                }
              >
                {linked
                  ? 'AgroFlow messages you on Telegram about dry zones, irrigation and your requests.'
                  : 'Connect Telegram to get messages about dry zones, irrigation and your requests.'}
              </Text>
            </View>

            {error ? (
              <Text
                style={
                  styles.infoLabel
                }
              >
                {
                  error
                }
              </Text>
            ) : null}

            <TouchableOpacity
              style={
                styles.changePasswordButton
              }
              onPress={() => {
                if (
                  busy
                ) {
                  return;
                }

                if (
                  linked
                ) {
                  handleDisconnect();

                  return;
                }

                void handleConnect();
              }}
              activeOpacity={
                0.75
              }
              disabled={
                busy
              }
            >
              <Text
                style={
                  styles.changePasswordText
                }
              >
                {busy
                  ? 'Please wait...'
                  : linked
                    ? 'Disconnect Telegram'
                    : 'Connect Telegram'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </>
  );
}
