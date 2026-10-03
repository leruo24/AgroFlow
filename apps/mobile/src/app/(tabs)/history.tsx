import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Clock3, Lightbulb } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DataState } from '@/components/DataState';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { createScreenStyles } from '@/styles/screenStyles';
import { createAlertHistoryStyles } from '@/styles/alertHistoryStyles';
import {
  describeStatus,
  fetchAlertHistory,
  type AlertHistoryItem,
  type AlertHistoryPeriod,
} from '@/services/alertHistoryService';

// Which half of the screen is showing. Irrigation events and alerts are both
// "what happened", but a farmer looking for one is never looking for the
// other, so they are tabs rather than one merged stream.
type Section = 'activity' | 'alerts';

type TypeFilter = 'all' | 'alert' | 'advice';

export default function HistoryScreen() {
  const {
    farm, history, zones,
    isZonesLoading, zonesError, refreshZones,
    isFarmLoading, farmError, refreshFarms,
  } = useAgroFlow();
  const { colors } = useTheme();
  const styles = useMemo(
    () => ({ ...createScreenStyles(colors), ...createAlertHistoryStyles(colors) }),
    [colors]
  );

  const loading = isFarmLoading || isZonesLoading;
  const error = farmError || zonesError;
  const ordered = [...history].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const [section, setSection] = useState<Section>('activity');
  const [alertItems, setAlertItems] = useState<AlertHistoryItem[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [period, setPeriod] = useState<AlertHistoryPeriod>(30);

  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones]);

  // Only fetched once the farmer actually opens the Alerts section - this is
  // two more queries and nobody opening History for an irrigation event needs
  // to pay for them.
  const loadAlerts = useCallback(async () => {
    if (zoneIds.length === 0) {
      setAlertItems([]);
      return;
    }

    setAlertsLoading(true);
    try {
      setAlertItems(await fetchAlertHistory(zoneIds, period));
    } finally {
      setAlertsLoading(false);
    }
  }, [zoneIds, period]);

  useEffect(() => {
    if (section === 'alerts') void loadAlerts();
  }, [section, loadAlerts]);

  const visible = alertItems.filter(
    (item) =>
      (zoneFilter === 'all' || item.zoneId === zoneFilter) &&
      (typeFilter === 'all' || item.kind === typeFilter)
  );

  const chip = (
    label: string,
    selected: boolean,
    onPress: () => void,
    key: string
  ) => (
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

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          title="History"
          subtitle={farm ? farm.name : 'Review irrigation and system activity.'}
          help="history"
        />

        {/* Section switch */}
        <View style={styles.filterRow}>
          {chip('Watering', section === 'activity', () => setSection('activity'), 'sec-activity')}
          {chip('Alerts & advice', section === 'alerts', () => setSection('alerts'), 'sec-alerts')}
        </View>

        {section === 'activity' ? (
          <>
            <View style={styles.summary}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{loading || error ? '—' : history.length}</Text>
                <Text style={styles.caption}>Recorded events</Text>
              </View>
            </View>

            <Text accessibilityRole="header" style={styles.sectionTitle}>Recent activity</Text>

            {loading ? (
              <DataState kind="loading" title="Loading activity" />
            ) : error ? (
              <DataState
                kind="error"
                title="Unable to load activity"
                onRetry={farmError ? refreshFarms : refreshZones}
              />
            ) : ordered.length === 0 ? (
              <DataState
                kind="empty"
                title="No recent activity"
                description="Irrigation actions and system events will appear here."
              />
            ) : (
              ordered.map((item) => (
                <View key={item.id} style={styles.row}>
                  <View style={styles.rowTop}>
                    <Clock3 size={21} color={colors.textSecondary} strokeWidth={1.7} />
                    <Text style={styles.title}>{item.action}</Text>
                  </View>
                  <Text style={styles.body}>{item.description}</Text>
                  <Text style={styles.caption}>{item.zone} · {item.source} · {item.type}</Text>
                  <Text style={styles.caption}>
                    {Number.isFinite(Date.parse(item.timestamp))
                      ? new Date(item.timestamp).toLocaleString()
                      : 'Time unavailable'}
                  </Text>
                </View>
              ))
            )}
          </>
        ) : (
          <>
            {/* ---- Filters ------------------------------------------- */}
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Zone</Text>
              <View style={styles.filterRow}>
                {chip('All zones', zoneFilter === 'all', () => setZoneFilter('all'), 'z-all')}
                {zones.map((z) =>
                  chip(z.name, zoneFilter === z.id, () => setZoneFilter(z.id), `z-${z.id}`)
                )}
              </View>
            </View>

            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Type</Text>
              <View style={styles.filterRow}>
                {chip('All', typeFilter === 'all', () => setTypeFilter('all'), 't-all')}
                {chip('Alerts', typeFilter === 'alert', () => setTypeFilter('alert'), 't-alert')}
                {chip('Advice', typeFilter === 'advice', () => setTypeFilter('advice'), 't-advice')}
              </View>
            </View>

            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>When</Text>
              <View style={styles.filterRow}>
                {chip('7 days', period === 7, () => setPeriod(7), 'p-7')}
                {chip('30 days', period === 30, () => setPeriod(30), 'p-30')}
                {chip('All', period === 'all', () => setPeriod('all'), 'p-all')}
              </View>
            </View>

            {/* ---- The list ------------------------------------------ */}
            {alertsLoading ? (
              <DataState kind="loading" title="Loading alerts" />
            ) : visible.length === 0 ? (
              <DataState kind="empty" title="No alerts yet." />
            ) : (
              visible.map((item) => (
                <View key={item.id} style={styles.row}>
                  <View style={styles.itemHeader}>
                    {item.kind === 'alert' ? (
                      <Bell size={19} color={colors.textSecondary} strokeWidth={1.7} />
                    ) : (
                      <Lightbulb size={19} color={colors.textSecondary} strokeWidth={1.7} />
                    )}
                    <Text style={styles.itemTitle} numberOfLines={2}>
                      {item.message || 'No message recorded'}
                    </Text>
                    <Text
                      style={item.status.state === 'new' ? styles.statusNew : styles.statusSeen}
                    >
                      {describeStatus(item.status)}
                    </Text>
                  </View>

                  <Text style={styles.caption}>
                    {[
                      item.zoneName ?? 'Zone',
                      item.kind === 'alert' ? 'Alert' : 'Advice',
                      Number.isFinite(Date.parse(item.timestamp))
                        ? new Date(item.timestamp).toLocaleString()
                        : 'Time unavailable',
                    ].join(' · ')}
                  </Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
