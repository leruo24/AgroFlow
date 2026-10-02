import { router } from 'expo-router';
import { AlertCircle, Bell, ChevronRight } from 'lucide-react-native';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DataState } from '@/components/DataState';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { createScreenStyles } from '@/styles/screenStyles';

export default function AlertsScreen() {
  const { farm, alerts, markAlertAsRead, isZonesLoading, zonesError, refreshZones, isFarmLoading, farmError, refreshFarms } = useAgroFlow();
  const { colors } = useTheme();
  const styles = createScreenStyles(colors);
  const loading = isFarmLoading || isZonesLoading;
  const error = farmError || zonesError;
  const ordered = [...alerts].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return <SafeAreaView style={styles.page} edges={['top']}><ScrollView contentContainerStyle={styles.content}>
    <ScreenHeader title="Alerts" subtitle={farm ? farm.name : 'Stay informed about your farm.'} help="alerts" />
    <View style={styles.summary}>{[['Total', alerts.length], ['Unread', alerts.filter(a => !a.read).length]].map(([label, value]) => <View key={label} style={styles.stat}><Text style={styles.statValue}>{loading || error ? '—' : value}</Text><Text style={styles.caption}>{label}</Text></View>)}</View>
    {loading ? <DataState kind="loading" title="Loading alerts" />
      : error ? <DataState kind="error" title="Unable to load alerts" onRetry={farmError ? refreshFarms : refreshZones} />
      : ordered.length === 0 ? <DataState kind="empty" title="No alerts right now" description="New alerts for this farm will appear here." />
      : ordered.map(alert => {
        const severe = /critical|error|danger/i.test(alert.type);
        const Icon = severe ? AlertCircle : Bell;
        return <TouchableOpacity key={alert.id} accessibilityRole="button" accessibilityLabel={alert.title + (alert.read ? ', read' : ', unread') + (alert.zoneId ? ', open zone' : ', mark read')} style={styles.row} onPress={() => {
          if (!alert.read) markAlertAsRead(alert.id);
          if (alert.zoneId) router.push({ pathname: '/zone/[id]', params: { id: alert.zoneId } });
        }}>
          <View style={styles.rowTop}><Icon size={21} color={severe ? colors.error : colors.textSecondary} strokeWidth={1.7} /><Text style={styles.title}>{alert.title}</Text>{!alert.read && <Text style={styles.buttonText}>Unread</Text>}{alert.zoneId && <ChevronRight size={19} color={colors.textSecondary} />}</View>
          <Text style={styles.body}>{alert.message}</Text>
          <Text style={styles.caption}>{[alert.zone, Number.isFinite(Date.parse(alert.timestamp)) ? new Date(alert.timestamp).toLocaleString() : 'Time unavailable'].filter(Boolean).join(' · ')}</Text>
        </TouchableOpacity>;
      })}
  </ScrollView></SafeAreaView>;
}
