// The Reports screen: ask for a PDF, see your requests, open a finished one.
// A report runs the whole FAO-56 engine over a date range, which can time out on rural
// data, so requests are queued, the list shows progress, and if Telegram is connected the
// PDF arrives there too.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { router } from '@/lib/router';

import { useTheme } from '@/context/ThemeContext';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AppAlert as Alert } from '@/components/AppAlert';
import { createReportsStyles } from '@/styles/reportsStyles';
import {
  createReportRequest,
  fetchAutoReportSummary,
  fetchReportRequests,
  openReportPdf,
  stopAutoReports,
  type AutoReportSummary,
  type ReportKind,
  type ReportPeriodChoice,
  type ReportRequestRow,
} from '@/services/agroFlowApi';

const REPORT_TYPES: { key: ReportKind; label: string; needsZone: boolean }[] = [
  { key: 'water_usage', label: 'Water usage', needsZone: false },
  // The moisture report takes a zoneId only, so it cannot run for a whole farm.
  { key: 'moisture', label: 'Soil moisture', needsZone: true },
  { key: 'schedule', label: 'Watering schedule & advice', needsZone: false },
];

const PERIODS: { key: ReportPeriodChoice; label: string }[] = [
  { key: 'last_7_days', label: 'Last 7 days' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'custom', label: 'Choose dates' },
];

export default function ReportsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createReportsStyles(colors), [colors]);
  const { farm, zones } = useAgroFlow();

  const [reportType, setReportType] = useState<ReportKind>('water_usage');
  const [period, setPeriod] = useState<ReportPeriodChoice>('last_7_days');
  const [zoneId, setZoneId] = useState<string>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [rows, setRows] = useState<ReportRequestRow[]>([]);
  const [auto, setAuto] = useState<AutoReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const needsZone = REPORT_TYPES.find((t) => t.key === reportType)?.needsZone ?? false;
  // The schedule report projects forward from today, so a period choice would change nothing.
  const usesDates = reportType !== 'schedule';

  const load = useCallback(async () => {
    try {
      const [list, summary] = await Promise.all([
        fetchReportRequests(),
        // Allowed to fail: a farm with no schedule has nothing to show, and the list must still load.
        fetchAutoReportSummary().catch(() => null),
      ]);
      setRows(list);
      setAuto(summary);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Your reports could not be loaded.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A report in progress does not change on screen by itself, so we re-check while anything
  // is in progress and stop as soon as nothing is.
  useEffect(() => {
    if (!rows.some((r) => r.status === 'preparing')) return;

    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [rows, load]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await createReportRequest({
        reportType,
        period: usesDates ? period : 'last_7_days',
        ...(period === 'custom' && usesDates
          ? { periodStart: customStart.trim(), periodEnd: customEnd.trim() }
          : {}),
        zoneId: needsZone || zoneId !== 'all' ? Number(zoneId) : null,
        farmId: farm?.id ?? null,
      });

      setMessage(result.message);
      await load();
    } catch (submitError) {
      // The farmer sees one plain sentence whatever went wrong; the real reason is in the server
      // log. A 400 is passed through, because those are about the farmer's own input ("A soil
      // moisture report is for one zone").
      const message =
        submitError instanceof Error ? submitError.message : '';

      const isOurFault =
        message.includes('500') ||
        message.includes('503') ||
        message.toLowerCase().includes('failed') ||
        message.length === 0;

      setError(
        isOurFault
          ? "This report couldn't be made. Try again later."
          : message
      );
    } finally {
      setSubmitting(false);
    }
  }, [reportType, period, zoneId, customStart, customEnd, needsZone, usesDates, farm?.id, load]);

  const confirmStopAuto = useCallback(() => {
    Alert.alert(
      'Stop automatic reports?',
      'You will stop getting reports on their own. You can still ask for one here any time, and our team can switch them back on for you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop them',
          style: 'destructive',
          onPress: () => {
            void stopAutoReports()
              .then((r) => {
                setMessage(r.message);
                void load();
              })
              .catch((e: unknown) =>
                setError(e instanceof Error ? e.message : 'That could not be changed.')
              );
          },
        },
      ]
    );
  }, [load]);

  const chip = (label: string, selected: boolean, onPress: () => void, key: string) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={selected ? styles.chipTextSelected : styles.chipText}>{label}</Text>
    </Pressable>
  );

  const statusStyle = (status: ReportRequestRow['status']) =>
    status === 'ready'
      ? styles.statusReady
      : status === 'failed'
        ? styles.statusFailed
        : styles.statusPreparing;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          style={{ alignSelf: 'flex-start' }}
        >
          <ArrowLeft size={24} color={colors.text} strokeWidth={2.25} />
        </Pressable>

        <ScreenHeader title="Your reports" subtitle={farm?.name ?? undefined} help="reports" />

        {/* Automatic reports, if the team set them up */}
        {auto?.enabled && (
          <View style={styles.autoCard}>
            <Text style={styles.autoTitle}>{auto.description}</Text>
            <Text style={styles.autoBody}>
              These arrive on their own. You will also find them in the list below.
            </Text>
            <Pressable
              onPress={confirmStopAuto}
              accessibilityRole="button"
              accessibilityLabel="Stop automatic reports"
              style={styles.autoStop}
            >
              <Text style={styles.autoStopText}>Stop automatic reports</Text>
            </Pressable>
          </View>
        )}

        {/* Request form */}
        <View style={styles.group}>
          <Text style={styles.groupLabel}>What kind of report</Text>
          <View style={styles.chipRow}>
            {REPORT_TYPES.map((t) =>
              chip(t.label, reportType === t.key, () => setReportType(t.key), t.key)
            )}
          </View>
        </View>

        {usesDates ? (
          <View style={styles.group}>
            <Text style={styles.groupLabel}>Which days</Text>
            <View style={styles.chipRow}>
              {PERIODS.map((p) => chip(p.label, period === p.key, () => setPeriod(p.key), p.key))}
            </View>

            {period === 'custom' && (
              <View style={styles.dateRow}>
                <View style={styles.dateField}>
                  <Text style={styles.dateLabel}>From</Text>
                  <TextInput
                    style={styles.dateInput}
                    value={customStart}
                    onChangeText={setCustomStart}
                    placeholder="2026-09-01"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    accessibilityLabel="Start date, year dash month dash day"
                  />
                </View>
                <View style={styles.dateField}>
                  <Text style={styles.dateLabel}>To</Text>
                  <TextInput
                    style={styles.dateInput}
                    value={customEnd}
                    onChangeText={setCustomEnd}
                    placeholder="2026-09-30"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    accessibilityLabel="End date, year dash month dash day"
                  />
                </View>
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.hint}>
            The watering schedule always covers today and the week ahead, so there are no dates to
            choose.
          </Text>
        )}

        <View style={styles.group}>
          <Text style={styles.groupLabel}>Which zone</Text>
          <View style={styles.chipRow}>
            {/* "All zones" is hidden for soil moisture - that report is for
                one zone and offering a choice that gets refused is worse
                than not offering it. */}
            {!needsZone && chip('All zones', zoneId === 'all', () => setZoneId('all'), 'z-all')}
            {zones.map((z) => chip(z.name, zoneId === z.id, () => setZoneId(z.id), `z-${z.id}`))}
          </View>
          {needsZone && zoneId === 'all' && (
            <Text style={styles.hint}>A soil moisture report is for one zone. Please pick one.</Text>
          )}

          {/* Picking a zone is not just a filter on the water usage report -
              it produces a different, fuller document: charts of what the
              crop needed against what it got, the week's soil moisture, and
              the advice behind it. Worth saying, because "All zones" reads
              like the more complete option and is in fact the shorter one. */}
          {reportType === 'water_usage' && (
            <Text style={styles.hint}>
              {zoneId === 'all'
                ? 'All zones gives a short summary. Pick one zone for the full report, with charts and advice.'
                : 'You will get the full report for this zone: charts, what the crop needed, and advice.'}
            </Text>
          )}
        </View>

        <Pressable
          onPress={submit}
          disabled={submitting || (needsZone && zoneId === 'all')}
          accessibilityRole="button"
          accessibilityLabel="Request this report"
          style={[
            styles.submit,
            (submitting || (needsZone && zoneId === 'all')) && styles.submitBusy,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.submitText}>Make me this report</Text>
          )}
        </Pressable>

        {message && <Text style={styles.message}>{message}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}

        {/* Past reports */}
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Your reports
        </Text>

        {loading ? (
          <ActivityIndicator color={colors.primaryDark} />
        ) : rows.length === 0 ? (
          <Text style={styles.hint}>You have not asked for a report yet.</Text>
        ) : (
          rows.map((row) => (
            <View key={row.id} style={styles.item}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{row.reportTypeLabel}</Text>
                <Text style={statusStyle(row.status)}>{row.statusLabel}</Text>
              </View>

              <Text style={styles.itemMeta}>
                {[
                  row.zoneName ?? 'All zones',
                  row.periodLabel,
                  row.requestedVia === 'auto' ? 'Sent automatically' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>

              {row.status === 'failed' && <Text style={styles.error}>{row.error}</Text>}

              {row.status === 'ready' && row.filePath && (
                <Pressable
                  onPress={() => {
                    void openReportPdf(row.filePath!).catch((e: unknown) =>
                      setError(
                        e instanceof Error ? e.message : 'This report could not be opened.'
                      )
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open the ${row.reportTypeLabel} report`}
                  style={styles.openButton}
                >
                  <Text style={styles.openButtonText}>Open</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
