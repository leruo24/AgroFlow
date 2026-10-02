import { Clock3 } from 'lucide-react-native';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { DataState } from '@/components/DataState';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { createScreenStyles } from '@/styles/screenStyles';

export default function HistoryScreen() {
  const { farm, history, isZonesLoading, zonesError, refreshZones, isFarmLoading, farmError, refreshFarms } = useAgroFlow();
  const { colors } = useTheme();
  const styles = createScreenStyles(colors);
  const loading = isFarmLoading || isZonesLoading;
  const error = farmError || zonesError;
  const ordered = [...history].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return <SafeAreaView style={styles.page} edges={['top']}><ScrollView contentContainerStyle={styles.content}>
    <ScreenHeader title="History" subtitle={farm ? farm.name : 'Review irrigation and system activity.'} help="history" />
    <View style={styles.summary}><View style={styles.stat}><Text style={styles.statValue}>{loading || error ? '—' : history.length}</Text><Text style={styles.caption}>Recorded events</Text></View></View>
    <Text accessibilityRole="header" style={styles.sectionTitle}>Recent activity</Text>
    {loading ? <DataState kind="loading" title="Loading activity" />
      : error ? <DataState kind="error" title="Unable to load activity" onRetry={farmError ? refreshFarms : refreshZones} />
      : ordered.length === 0 ? <DataState kind="empty" title="No recent activity" description="Irrigation actions and system events will appear here." />
      : ordered.map(item => <View key={item.id} style={styles.row}>
        <View style={styles.rowTop}><Clock3 size={21} color={colors.textSecondary} strokeWidth={1.7} /><Text style={styles.title}>{item.action}</Text></View>
        <Text style={styles.body}>{item.description}</Text>
        <Text style={styles.caption}>{item.zone} · {item.source} · {item.type}</Text>
        <Text style={styles.caption}>{Number.isFinite(Date.parse(item.timestamp)) ? new Date(item.timestamp).toLocaleString() : 'Time unavailable'}</Text>
      </View>)}
  </ScrollView></SafeAreaView>;
}
