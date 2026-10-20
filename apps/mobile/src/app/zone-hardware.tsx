// The Kit screen. Reached as /zone-hardware?zoneId=123&zoneName=Tunnel%201
// The farmer only ever sees the word "Kit": it is the box they were given at installation.
// It answers two questions, in this order:
//   1. Is my kit working? (one plain line at the top)
//   2. My WiFi changed, how do I fix it? (the Change WiFi button and its instructions)
// Kit ID and firmware version are below, for when someone on a support call asks.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/lib/router';

import { useTheme } from '@/context/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { BlurSheet } from '@/components/BlurSheet';
import { AppAlert as Alert } from '@/components/AppAlert';
import { createZoneHardwareStyles } from '@/styles/zoneHardwareStyles';
import {
  fetchZoneHardware,
  requestZoneWifiChange,
  KitOfflineError,
  type ZoneHardware,
} from '@/services/agroFlowApi';
import { useBottomPadding } from '@/hooks/useScreenPadding';

// "last seen 4 minutes ago" in as few words as possible. Null when there is nothing to say,
// so the caller shows no clause instead of "last seen never".
function describeLastSeen(iso: string | null): string | null {
  if (!iso) return null;

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const minutes = Math.floor((Date.now() - then) / 60000);

  // A kit that reported seconds ago, or a clock slightly ahead of ours.
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export default function ZoneHardwareScreen() {
  // The floating tab bar (if any), the bottom safe area and 16 below the last control.
  const bottomPad = useBottomPadding(false);
  const { colors } = useTheme();
  const styles = useMemo(() => createZoneHardwareStyles(colors), [colors]);

  const params = useLocalSearchParams<{ zoneId?: string; zoneName?: string }>();
  const zoneId = Number(params.zoneId);
  const zoneName = params.zoneName ?? 'this zone';

  const [kit, setKit] = useState<ZoneHardware | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [changing, setChanging] = useState(false);
  const [offline, setOffline] = useState<KitOfflineError | null>(null);
  const [instructionsFor, setInstructionsFor] = useState<{
    network: string;
    password: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(zoneId) || zoneId <= 0) {
      setError('This zone could not be found.');
      setLoading(false);
      return;
    }

    try {
      setError(null);
      setKit(await fetchZoneHardware(zoneId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Your kit details could not be loaded.'
      );
    } finally {
      setLoading(false);
    }
  }, [zoneId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Two steps: the dialog confirms, and the sheet that follows has the instructions, which
  // the farmer needs while they leave the app to switch WiFi.
  const confirmChangeWifi = useCallback(() => {
    Alert.alert(
      'Change WiFi?',
      'Your kit will forget its current WiFi and open its own setup network. Watering keeps running in the meantime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change WiFi',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setChanging(true);
              setOffline(null);
              setError(null);

              try {
                const result = await requestZoneWifiChange(zoneId);

                setInstructionsFor({
                  network: result.setupNetworkName,
                  password: result.setupNetworkPassword,
                });
              } catch (changeError) {
                // The kit is not listening: completely different advice, so it gets its own block.
                if (changeError instanceof KitOfflineError) {
                  setOffline(changeError);
                } else {
                  setError(
                    changeError instanceof Error
                      ? changeError.message
                      : 'Your kit could not be reached.'
                  );
                }
              } finally {
                setChanging(false);
                // The kit was just told to drop its WiFi, so the status on screen is already out of date.
                void load();
              }
            })();
          },
        },
      ]
    );
  }, [zoneId, load]);

  const lastSeenPhrase = describeLastSeen(kit?.lastSeen ?? null);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.navigate('/irrigation'))}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          style={{ alignSelf: 'flex-start' }}
        >
          <ArrowLeft size={24} color={colors.text} strokeWidth={2.25} />
        </Pressable>

        <ScreenHeader title="Your kit" subtitle={zoneName} help="zoneHardware" />

        {loading ? (
          <ActivityIndicator color={colors.primaryDark} />
        ) : error && !kit ? (
          <Text style={styles.error}>{error}</Text>
        ) : !kit || kit.hardwareId === null ? (
          // A zone with no kit installed. Nothing is wrong; the farmer has no box here yet.
          <View style={styles.statusCard}>
            <Text style={styles.statusHeadline}>No kit here yet</Text>
            <Text style={styles.statusDetail}>
              This zone has no kit installed. Watering is set by hand until one is fitted.
            </Text>
          </View>
        ) : (
          <>
            {/* 1. Status */}
            <View
              style={[
                styles.statusCard,
                kit.online ? styles.statusCardOnline : styles.statusCardOffline,
              ]}
            >
              <Text style={styles.statusHeadline}>
                {kit.online
                  ? 'Online'
                  : lastSeenPhrase
                    ? `Offline, last seen ${lastSeenPhrase}`
                    : 'Offline'}
              </Text>

              <Text style={styles.statusDetail}>
                {kit.online
                  ? 'Your kit is talking to us and your watering is running normally.'
                  : 'We have not heard from your kit recently. Check that it has power and that your WiFi is working.'}
              </Text>
            </View>

            {/* 2. Sensors */}
            {/* Per sensor, because they fail separately. A dead temperature
                sensor does not stop watering - the soil probe is what
                decides that - so saying so is the difference between a
                farmer who ignores it and one who drives out to the field. */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Sensors</Text>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Soil sensor</Text>
                <Text style={kit.soilSensorWorking ? styles.rowValue : styles.rowValueWarning}>
                  {kit.soilSensorWorking ? 'Working' : 'Not responding'}
                </Text>
              </View>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Temperature sensor</Text>
                <Text
                  style={
                    kit.temperatureSensorWorking ? styles.rowValue : styles.rowValueWarning
                  }
                >
                  {kit.temperatureSensorWorking ? 'Working' : 'Not responding'}
                </Text>
              </View>

              <View style={[styles.row, styles.rowLast]}>
                <Text style={styles.rowLabel}>Damp-in-the-air sensor</Text>
                <Text style={kit.humiditySensorWorking ? styles.rowValue : styles.rowValueWarning}>
                  {kit.humiditySensorWorking ? 'Working' : 'Not responding'}
                </Text>
              </View>

              {(!kit.temperatureSensorWorking || !kit.humiditySensorWorking) && (
                <Text style={styles.rowNote}>
                  Not responding: using weather app data. Your watering carries on as normal - the
                  soil sensor is what decides when to water.
                </Text>
              )}

              {!kit.soilSensorWorking && (
                <Text style={styles.rowNote}>
                  Without the soil sensor your kit cannot decide when to water on its own. It will
                  keep to its timetable, and you can still water by hand.
                </Text>
              )}
            </View>

            {/* 3. Kit details */}
            {/* Last, and quietly. Only ever needed when somebody on a phone
                call asks which kit this is. */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Kit details</Text>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Kit ID</Text>
                <Text style={styles.rowValueMuted}>{kit.deviceId ?? 'Not known yet'}</Text>
              </View>

              <View style={[styles.row, styles.rowLast]}>
                <Text style={styles.rowLabel}>Version</Text>
                <Text style={styles.rowValueMuted}>
                  {kit.firmwareVersion ?? 'Not reported yet'}
                </Text>
              </View>
            </View>

            {/* 4. Change WiFi */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>WiFi</Text>

              <Text style={styles.rowNote}>
                Use this if you got a new router, or changed your WiFi name or password.
              </Text>

              <Pressable
                onPress={confirmChangeWifi}
                disabled={changing}
                accessibilityRole="button"
                accessibilityLabel="Change WiFi"
                style={[styles.primaryButton, changing && styles.primaryButtonBusy]}
              >
                {changing ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.primaryButtonText}>Change WiFi</Text>
                )}
              </Pressable>

              {/* The offline answer. Shown here rather than in a dialog so
                  the farmer can read it while standing at the kit, and so
                  the power-cycle instruction does not vanish on a tap. */}
              {offline && (
                <View style={styles.offlineBlock}>
                  <Text style={styles.offlineText}>{offline.message}</Text>
                  <Text style={styles.offlineHint}>{offline.hint}</Text>

                  {offline.setupNetworkName && offline.setupNetworkPassword && (
                    <View style={styles.credentialBlock}>
                      <Text style={styles.credentialLabel}>Then join this network</Text>
                      <Text style={styles.credential}>{offline.setupNetworkName}</Text>
                      <Text style={styles.credentialLabel}>Password</Text>
                      <Text style={styles.credential}>{offline.setupNetworkPassword}</Text>
                    </View>
                  )}
                </View>
              )}

              {error && kit && <Text style={styles.error}>{error}</Text>}
            </View>

            {/* The WiFi handover needs a phone: step 1 is joining the kit's
                own network, which a desktop browser realistically cannot do.
                Everything on this screen still WORKS on the web - the status,
                the sensors, even sending the command - so this is a note, not
                a disabled button. Saying it up front is kinder than letting
                someone send the command and then discover they cannot finish
                it. */}
            {Platform.OS === 'web' && (
              <Text style={styles.footnote}>
                You are using AgroFlow in a browser. To finish a WiFi change you need the phone
                that will join your kit&apos;s setup network, so do this step on your phone.
              </Text>
            )}

            <Text style={styles.footnote}>
              Your kit keeps watering on its own while it is off WiFi, using the last readings it
              took.
            </Text>
          </>
        )}
      </ScrollView>

      {/* The instructions sheet, after a successful change */}
      {/* Three numbered steps, because the farmer has to leave this app to
          do step 1 and come back. Nothing here is a countdown or a spinner:
          the kit reconnects by itself and the app cannot see it happen. */}
      <BlurSheet
        visible={instructionsFor !== null}
        onClose={() => setInstructionsFor(null)}
        title="Now set up your WiFi"
      >
        <View style={styles.sheetBody}>
          <Text style={styles.sheetIntro}>
            Your kit has opened its own WiFi network. Three steps:
          </Text>

          <View style={styles.step}>
            <Text style={styles.stepNumber}>1</Text>
            <Text style={styles.stepText}>
              On this phone, join the WiFi network{' '}
              <Text style={styles.credential}>{instructionsFor?.network}</Text> (password{' '}
              <Text style={styles.credential}>{instructionsFor?.password}</Text>).
            </Text>
          </View>

          <View style={styles.step}>
            <Text style={styles.stepNumber}>2</Text>
            <Text style={styles.stepText}>
              A setup page opens. Choose your new WiFi and enter its password.
            </Text>
          </View>

          <View style={styles.step}>
            <Text style={styles.stepNumber}>3</Text>
            <Text style={styles.stepText}>Your kit reconnects by itself within a minute.</Text>
          </View>

          <Text style={styles.footnote}>
            The setup network stays open for 5 minutes. If it closes before you get there, unplug
            and replug your kit 3 times quickly to open it again.
          </Text>
        </View>
      </BlurSheet>
    </SafeAreaView>
  );
}
