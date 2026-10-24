// "More" in the bottom bar: the screens that used to be tabs (History, Settings) and the ones
// reached from elsewhere (Reports, Tank, Forecast), plus Help. Every route is unchanged, so old
// links and buttons still open the same screens.
import { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
import { router } from '@/lib/router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, CardList } from '@/components/ui/Card';
import { FieldGuide } from '@/components/visual/FieldGuide';
import { useTheme } from '@/context/ThemeContext';
import { useI18n, type TranslationKey } from '@/i18n';
import { useBottomPadding } from '@/hooks/useScreenPadding';
import { createScreenStyles } from '@/styles/screenStyles';

// The routes, in the order farmers asked for them.
export const MORE_ITEMS: { key: 'history' | 'reports' | 'tank' | 'forecast' | 'settings'; href: string }[] = [
  { key: 'history', href: '/history' },
  { key: 'reports', href: '/reports' },
  { key: 'tank', href: '/tank' },
  { key: 'forecast', href: '/forecast' },
  { key: 'settings', href: '/settings' },
];

export default function MoreScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const bottom = useBottomPadding();
  const styles = useMemo(() => createScreenStyles(colors), [colors]);

  return <SafeAreaView style={styles.page} edges={['top']}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]} testID="more-tab">
      <ScreenHeader title={t('more.title')} subtitle={t('more.intro')} />
      <CardList>
        {MORE_ITEMS.map(item => <Card key={item.key} testID={`more-${item.key}`}>
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push(item.href as never)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 }} testID={`more-open-${item.key}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t(`more.${item.key}` as TranslationKey)}</Text>
              <Text style={styles.caption}>{t(`more.${item.key}Body` as TranslationKey)}</Text>
            </View>
            <ChevronRight size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </Card>)}
        <Card testID="more-help">
          <Text style={styles.title}>{t('more.help')}</Text>
          <Text style={styles.caption}>{t('more.helpBody')}</Text>
          <FieldGuide />
        </Card>
      </CardList>
    </ScrollView>
  </SafeAreaView>;
}
