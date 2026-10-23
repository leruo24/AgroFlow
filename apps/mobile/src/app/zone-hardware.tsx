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
import { t, useI18n } from '@/i18n';

// "last seen 4 minutes ago" in as few words as possible. Null when there is nothing to say,
// so the caller shows no clause instead of "last seen never".
function describeLastSeen(iso: string | null): string | null {
  if (!iso) return null;

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const minutes = Math.floor((Date.now() - then) / 60000);

  // A kit that reported seconds ago, or a clock slightly ahead of ours.
  if (minutes < 1) return t('sensor.justNow');
  if (minutes < 60) return t('sensor.minAgo', { n: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('sensor.hoursAgo', { n: hours });

  const days = Math.floor(hours / 24);
  return days === 1 ? t('kit.yesterday') : t('sensor.daysAgo', { n: days });
}

export default function ZoneHardwareScreen() {
  // Re-renders in the farmer's language; t() below reads the same choice.
  useI18n();
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
      setError(t('kit.noZone'));
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
          : t('kit.loadFailed')
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
      t('kit.changeTitle'),
      t('kit.changeBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('kit.change'),
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
                      : t('kit.unreachable')
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
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          style={{ alignSelf: 'flex-start' }}
        >
          <ArrowLeft size={24} color={colors.text} strokeWidth={2.25} />
        </Pressable>

        <ScreenHeader title={t('kit.title')} subtitle={zoneName} help="zoneHardware" />

        {loading ? (
          <ActivityIndicator color={colors.primaryDark} />
        ) : error && !kit ? (
          <Text style={styles.error}>{error}</Text>
        ) : !kit || kit.hardwareId === null ? (
          // A zone with no kit installed. Nothing is wrong; the farmer has no box here yet.
          <View style={styles.statusCard}>
            <Text style={styles.statusHeadline}>{t('kit.none')}</Text>
            <Text style={styles.statusDetail}>
              {t('kit.noneBody')}
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
                  ? t('kit.online')
                  : lastSeenPhrase
                    ? t('kit.offlineSeen', { when: lastSeenPhrase })
                    : t('kit.offline')}
              </Text>

              <Text style={styles.statusDetail}>
                {kit.online
                  ? t('kit.onlineBody')
                  : t('kit.offlineBody')}
              </Text>
            </View>

            {/* 2. Sensors */}
            {/* Per sensor, because they fail separately. A dead temperature
                sensor does not stop watering - the soil probe is what
                decides that - so saying so is the difference between a
                farmer who ignores it and one who drives out to the field. */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('kit.sensors')}</Text>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t('zone.row.soilSensor')}</Text>
                <Text style={kit.soilSensorWorking ? styles.rowValue : styles.rowValueWarning}>
                  {kit.soilSensorWorking ? t('kit.working') : t('kit.notResponding')}
                </Text>
              </View>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t('kit.tempSensor')}</Text>
                <Text
                  style={
                    kit.temperatureSensorWorking ? styles.rowValue : styles.rowValueWarning
                  }
                >
                  {kit.temperatureSensorWorking ? t('kit.working') : t('kit.notResponding')}
                </Text>
              </View>

              <View style={[styles.row, styles.rowLast]}>
                <Text style={styles.rowLabel}>{t('kit.humiditySensor')}</Text>
                <Text style={kit.humiditySensorWorking ? styles.rowValue : styles.rowValueWarning}>
                  {kit.humiditySensorWorking ? t('kit.working') : t('kit.notResponding')}
                </Text>
              </View>

              {(!kit.temperatureSensorWorking || !kit.humiditySensorWorking) && (
                <Text style={styles.rowNote}>
                  {t('kit.airSensorNote')}
                </Text>
              )}

              {!kit.soilSensorWorking && (
                <Text style={styles.rowNote}>
                  {t('kit.soilSensorNote')}
                </Text>
              )}
            </View>

            {/* 3. Kit details */}
            {/* Last, and quietly. Only ever needed when somebody on a phone
                call asks which kit this is. */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('kit.details')}</Text>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t('kit.id')}</Text>
                <Text style={styles.rowValueMuted}>{kit.deviceId ?? t('kit.notKnown')}</Text>
              </View>

              <View style={[styles.row, styles.rowLast]}>
                <Text style={styles.rowLabel}>{t('kit.version')}</Text>
                <Text style={styles.rowValueMuted}>
                  {kit.firmwareVersion ?? t('kit.notReported')}
                </Text>
              </View>
            </View>

            {/* 4. Change WiFi */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('kit.wifi')}</Text>

              <Text style={styles.rowNote}>
                {t('kit.wifiWhen')}
              </Text>

              <Pressable
                onPress={confirmChangeWifi}
                disabled={changing}
                accessibilityRole="button"
                accessibilityLabel={t('kit.change')}
                style={[styles.primaryButton, changing && styles.primaryButtonBusy]}
              >
                {changing ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.primaryButtonText}>{t('kit.change')}</Text>
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
                      <Text style={styles.credentialLabel}>{t('kit.thenJoin')}</Text>
                      <Text style={styles.credential}>{offline.setupNetworkName}</Text>
                      <Text style={styles.credentialLabel}>{t('signin.password')}</Text>
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
                {t('kit.webNote')}
              </Text>
            )}

            <Text style={styles.footnote}>
              {t('kit.offWifiNote')}
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
        title={t('kit.sheetTitle')}
      >
        <View style={styles.sheetBody}>
          <Text style={styles.sheetIntro}>
            {t('kit.sheetIntro')}
          </Text>

          <View style={styles.step}>
            <Text style={styles.stepNumber}>1</Text>
            <Text style={styles.stepText}>
              {t('kit.step1Join')}{' '}
              <Text style={styles.credential}>{instructionsFor?.network}</Text> ({t('kit.step1Password')}{' '}
              <Text style={styles.credential}>{instructionsFor?.password}</Text>).
            </Text>
          </View>

          <View style={styles.step}>
            <Text style={styles.stepNumber}>2</Text>
            <Text style={styles.stepText}>
              {t('kit.step2')}
            </Text>
          </View>

          <View style={styles.step}>
            <Text style={styles.stepNumber}>3</Text>
            <Text style={styles.stepText}>{t('kit.step3')}</Text>
          </View>

          <Text style={styles.footnote}>
            {t('kit.setupWindow')}
          </Text>
        </View>
      </BlurSheet>
    </SafeAreaView>
  );
}
