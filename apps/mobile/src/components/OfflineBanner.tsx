import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CloudOff } from 'lucide-react-native';
import { useTheme } from '@/context/ThemeContext';
import { Radius, Spacing, Type } from '@/constants/colors';
import { useConnectivity } from '@/lib/connectivity';
import { savedAtLabel } from '@/lib/offlineCache';
import { useOfflineQueue } from '@/lib/offlineQueue';
import { useI18n } from '@/i18n';

// "You're offline — showing data from today 08:15", at the top of every screen with a header,
// plus how many refills, pH readings or soil checks are waiting to be sent. Says nothing at all
// while online with nothing waiting.
export function OfflineBanner() {
  const { colors } = useTheme();
  const { t, lang } = useI18n();
  const { online, dataFrom } = useConnectivity();
  const { pending, problems } = useOfflineQueue();
  const styles = useMemo(() => StyleSheet.create({
    banner: {
      flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two,
      backgroundColor: colors.warningBackground, borderColor: colors.warning, borderWidth: 1,
      borderRadius: Radius.sm, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, marginBottom: Spacing.three,
    },
    textColumn: { flex: 1, gap: 2 },
    text: { color: colors.text, fontSize: Type.body, fontWeight: '600', lineHeight: 22 },
    small: { color: colors.textSecondary, fontSize: Type.caption, lineHeight: 19 },
    problem: { color: colors.error, fontSize: Type.caption, lineHeight: 19 },
  }), [colors]);

  if (online && pending === 0 && problems.length === 0) return null;

  let headline: string | null = null;
  if (!online) {
    if (dataFrom === null) headline = t('offline.bannerNoData');
    else {
      const when = savedAtLabel(dataFrom, Date.now(), lang === 'en' ? 'en-ZA' : lang === 'af' ? 'af-ZA' : 'en-ZA');
      const time = when.day === 'today' ? t('offline.today', { time: when.text })
        : when.day === 'yesterday' ? t('offline.yesterday', { time: when.text })
        : when.text;
      headline = t('offline.banner', { time });
    }
  }

  return <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="offline-banner">
    {!online ? <CloudOff size={20} color={colors.warning} /> : null}
    <View style={styles.textColumn}>
      {headline ? <Text style={styles.text}>{headline}</Text> : null}
      {pending > 0 ? <Text style={styles.small}>{pending === 1 ? t('offline.pendingOne') : t('offline.pending', { count: pending })}</Text> : null}
      {problems.slice(-2).map((p, i) => <Text key={`${p.createdAt}-${i}`} style={styles.problem}>{t('offline.problem', { message: p.message })}</Text>)}
    </View>
  </View>;
}
