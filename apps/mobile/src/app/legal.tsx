// The draft terms of service and privacy notice, as the server serves them
// (GET /api/public/legal/{terms|privacy}): the exact text, version and date the farmer accepts.
// Both are marked "Draft – needs approval" until the team approves them. /legal?doc=terms
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { router } from '@/lib/router';
import { useTheme } from '@/context/ThemeContext';
import { Layout, Spacing, Type, type AppColors } from '@/constants/colors';
import { useI18n } from '@/i18n';
import { fetchLegalText } from '@/services/agroFlowApi';
import { useBottomPadding } from '@/hooks/useScreenPadding';

export default function LegalScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const bottom = useBottomPadding(false);
  const params = useLocalSearchParams<{ doc?: string }>();
  const doc = params.doc === 'privacy' ? 'privacy' : 'terms';
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false); setText(null);
    fetchLegalText(doc).then(setText).catch(() => setFailed(true));
  }, [doc]);
  useEffect(load, [load]);

  // The documents are plain Markdown: headings, paragraphs and "- " lists, shown as text.
  const blocks = (text ?? '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean);

  return <SafeAreaView style={styles.page} edges={['top']}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))} accessibilityRole="button"
        accessibilityLabel={t('common.back')} hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 48, justifyContent: 'center' }}>
        <ArrowLeft size={24} color={colors.text} strokeWidth={2.25} />
      </Pressable>
      {failed ? <View style={{ gap: Spacing.two }}>
        <Text style={styles.body}>{t('terms.loadFailed')}</Text>
        <Pressable accessibilityRole="button" onPress={load} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={styles.link}>{t('common.retry')}</Text>
        </Pressable>
      </View> : text === null ? <ActivityIndicator color={colors.primaryDark} accessibilityLabel={t('common.loading')} />
        : blocks.map((b, i) => b.startsWith('# ')
          ? <Text key={i} accessibilityRole="header" style={styles.h1}>{b.slice(2)}</Text>
          : b.startsWith('## ')
            ? <Text key={i} accessibilityRole="header" style={styles.h2}>{b.slice(3)}</Text>
            : <Text key={i} style={styles.body}>{b.replace(/\*\*/g, '').replace(/^- /gm, '• ')}</Text>)}
      <Text style={styles.note}>{t('terms.englishOnly')}</Text>
    </ScrollView>
  </SafeAreaView>;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    content: { padding: Layout.gutter, gap: Spacing.three, maxWidth: 720, width: '100%', alignSelf: 'center' },
    h1: { color: colors.text, fontSize: 26, lineHeight: 32, fontWeight: '700' },
    h2: { color: colors.text, fontSize: Type.title, fontWeight: '700' },
    body: { color: colors.text, fontSize: Type.body, lineHeight: 24 },
    link: { color: colors.primaryDark, fontSize: Type.body, fontWeight: '600', textDecorationLine: 'underline' },
    note: { color: colors.textSecondary, fontSize: Type.caption, lineHeight: 20 },
  });
}
