import { formatSast } from '@/lib/sastTime';
import { router } from '@/lib/router';
import { AlertCircle, Bell, ChevronRight } from 'lucide-react-native';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DataState } from '@/components/DataState';
import { Card, CardList } from '@/components/ui/Card';
import { StatsRow } from '@/components/ui/StatsRow';
import { useBottomPadding } from '@/hooks/useScreenPadding';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { createScreenStyles } from '@/styles/screenStyles';
import { Layout } from '@/constants/colors';
import { useI18n } from '@/i18n';
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { WhyLink } from '@/components/WhySheet';
import { fetchAlertExplanations } from '@/services/insightsService';
import {
  dismissNotification,
  fetchDismissals,
  restoreNotification,
  type Dismissal,
  type Explanation,
} from '@/services/agroFlowApi';
import { activeDismissal, alertKey, dismissedLine, type DismissView } from '@/lib/dismissals';
import { DismissButton, DismissNoteSheet, UndoBar, ViewSwitch } from '@/components/DismissControls';

export default function AlertsScreen() {
  const { t } = useI18n();
  const { farm, alerts, markAlertAsRead, isZonesLoading, zonesError, refreshZones, isFarmLoading, farmError, refreshFarms } = useAgroFlow();
  const { colors } = useTheme();
  const styles = createScreenStyles(colors);
  const bottom = useBottomPadding();
  const loading = isFarmLoading || isZonesLoading;
  const error = farmError || zonesError;
  const ordered = [...alerts].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  // Alerts are produced by backend workers and devices while the farmer uses other screens.
  // Refresh on focus so returning to this tab shows those events without an app reload.
  useFocusEffect(useCallback(() => {
    refreshZones();
  }, [refreshZones]));

  // Each alert's "Why am I seeing this?", read once per set of alerts.
  const alertKeyList = alerts.map(a => a.id).join(',');
  const [why, setWhy] = useState<Record<string, Explanation>>({});
  useEffect(() => {
    let active = true;
    fetchAlertExplanations(alerts.map(a => a.id)).then(result => { if (active) setWhy(result); });
    return () => { active = false; };
    // alertKeyList instead of alerts: the context rebuilds an equal array often.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertKeyList]);

  // Dismiss (x) with Undo, and Active / Dismissed / All.
  const [view, setView] = useState<DismissView>('active');
  const [dismissals, setDismissals] = useState<Dismissal[]>([]);
  const [undo, setUndo] = useState<{ id: number; message: string } | null>(null);
  const [asking, setAsking] = useState<{ key: string; title: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Alerts whose "read" could not be saved (AF-04): they stay unread and offer Try again.
  const [unsaved, setUnsaved] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const saveRead = useCallback(async (id: string) => {
    if (saving[id]) return;
    setSaving(s => ({ ...s, [id]: true }));
    const ok = await markAlertAsRead(id);
    setSaving(s => ({ ...s, [id]: false }));
    setUnsaved(u => ({ ...u, [id]: !ok }));
  }, [markAlertAsRead, saving]);

  const loadDismissals = useCallback(() => {
    if (!farm) return;
    fetchDismissals(farm.id).then(setDismissals).catch(() => setDismissals([]));
  }, [farm]);
  useEffect(loadDismissals, [loadDismissals]);

  const dismiss = useCallback((key: string, note: string | null) => {
    setProblem(null);
    dismissNotification('alert', key, note)
      .then((r) => { setUndo({ id: r.id, message: 'Alert dismissed.' }); loadDismissals(); })
      .catch((e: unknown) => setProblem(e instanceof Error && e.message ? e.message : 'Could not dismiss that alert.'));
  }, [loadDismissals]);

  const restore = useCallback((id: number) => {
    restoreNotification(id).then(loadDismissals)
      .catch((e: unknown) => setProblem(e instanceof Error && e.message ? e.message : 'Could not restore that alert.'));
  }, [loadDismissals]);

  const visible = ordered.filter(a => !activeDismissal(dismissals, 'alert', alertKey(a.id)));
  const history = dismissals.filter(d => d.kind === 'alert');

  return <SafeAreaView style={styles.page} edges={['top']}><ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
    <ScreenHeader title={t('alerts.title')} subtitle={farm ? farm.name : t('alerts.subtitle')} help="alerts" />
    <StatsRow stats={[
      { label: t('alerts.total'), value: loading || error ? '—' : String(alerts.length) },
      { label: t('alerts.unread'), value: loading || error ? '—' : String(alerts.filter(a => !a.read).length) },
    ]} />
    <ViewSwitch value={view} onChange={setView} />
    <UndoBar message={undo?.message ?? null} onUndo={() => undo && restore(undo.id)} onDone={() => setUndo(null)} />
    {problem ? <Text style={[styles.caption, { color: colors.error }]} accessibilityLiveRegion="polite">{problem}</Text> : null}
    {view !== 'dismissed' && (loading ? <DataState kind="loading" title={t('alerts.loading')} />
      : error ? <DataState kind="error" title={t('alerts.unavailable')} onRetry={farmError ? refreshFarms : refreshZones} />
      : visible.length === 0 ? <DataState kind="empty" title={t('alerts.none')} description={t('alerts.noneBody')} />
      : <CardList style={{ marginTop: Layout.headingToCard }}>{visible.map(alert => {
        const severe = /critical|error|danger/i.test(alert.type);
        const Icon = severe ? AlertCircle : Bell;
        const key = alertKey(alert.id);
        const open = () => {
          if (!alert.read) void saveRead(alert.id);
          if (alert.zoneId) router.push({ pathname: '/zone/[id]', params: { id: alert.zoneId } });
        };
        // The Dismiss and Why buttons sit beside the tap areas, not inside them: a button inside
        // a button is invalid on web and cannot be reached by a screen reader on a phone.
        return <Card key={alert.id} tone={severe ? 'error' : undefined}>
          <View style={styles.rowTop}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={alert.title + (alert.read ? ', read' : ', unread') + (alert.zoneId ? ', open zone' : ', mark read')} style={[styles.rowTop, { flex: 1 }]} onPress={open}>
              <Icon size={21} color={severe ? colors.error : colors.textSecondary} strokeWidth={1.7} /><Text style={styles.title} numberOfLines={2}>{alert.title}</Text>{!alert.read && <Text style={styles.buttonText}>{t('alerts.unreadTag')}</Text>}{alert.zoneId && <ChevronRight size={19} color={colors.textSecondary} />}
            </TouchableOpacity>
            {key && <DismissButton label={alert.title} onPress={() => severe ? setAsking({ key, title: alert.title }) : dismiss(key, null)} />}
          </View>
          <TouchableOpacity accessible={false} onPress={open}><Text style={styles.body}>{alert.message}</Text></TouchableOpacity>
          <WhyLink explanation={why[alert.id]} compact />
          <TouchableOpacity accessible={false} onPress={open}><Text style={styles.caption}>{[alert.zone, formatSast(alert.timestamp) ?? t('alerts.noTime')].filter(Boolean).join(' · ')}</Text></TouchableOpacity>
          {unsaved[alert.id] && !alert.read ? <View style={styles.rowTop} testID={`alert-read-failed-${alert.id}`}>
            <Text style={[styles.caption, { color: colors.error, flex: 1 }]} accessibilityLiveRegion="polite">{t('alerts.readFailed')}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('alerts.readRetryA11y', { title: alert.title })}
              disabled={saving[alert.id]} onPress={() => { void saveRead(alert.id); }} testID={`alert-read-retry-${alert.id}`}>
              <Text style={styles.buttonText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View> : null}
        </Card>;
      })}</CardList>)}
    {view !== 'active' && <>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{t('alerts.dismissed')}</Text>
      {history.length === 0 ? <Text style={styles.caption}>{t('alerts.noneDismissed')}</Text>
        : <CardList>{history.map(d => <Card key={d.id} testID={`dismissed-${d.id}`}>
          <Text style={styles.title}>{d.title}</Text>
          {d.raisedAt ? <Text style={styles.caption}>Raised {formatSast(d.raisedAt)}</Text> : null}
          <Text style={styles.caption}>{dismissedLine(d, formatSast)}</Text>
          {d.note ? <Text style={styles.body}>Note: {d.note}</Text> : null}
          {!d.restoredAt && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Restore ${d.title}`} onPress={() => restore(d.id)}>
            <Text style={styles.buttonText}>{t('alerts.restore')}</Text>
          </TouchableOpacity>}
        </Card>)}</CardList>}
    </>}
  </ScrollView>
  <DismissNoteSheet title={asking?.title ?? ''} visible={asking !== null} onCancel={() => setAsking(null)}
    onConfirm={(note) => { if (asking) dismiss(asking.key, note); setAsking(null); }} />
  </SafeAreaView>;
}
