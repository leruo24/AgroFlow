// Settings → Service & support (Part B): the service status, who pays, the plan as staff recorded
// it, the example price (staff-editable, never a bill) and how to get help. Only what the server
// holds is shown: no invoices, balances or dates are invented (GET /api/farmer/service).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from '@/lib/router';
import { useTheme } from '@/context/ThemeContext';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { useI18n, type TranslationKey } from '@/i18n';
import { fetchServiceSupport, type ServiceSupport } from '@/services/agroFlowApi';

export function ServiceSupportCard() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { farm } = useAgroFlow();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [service, setService] = useState<{ farmId: string | null; value: ServiceSupport } | null>(null);
  const [failed, setFailed] = useState(false);
  const farmId = farm?.id ?? null;

  const load = useCallback(() => {
    setFailed(false);
    fetchServiceSupport(farmId).then(value => setService({ farmId, value })).catch(() => setFailed(true));
  }, [farmId]);
  useEffect(load, [load]);

  const s = service && service.farmId === farmId ? service.value : null;
  const amount = (n: number) => `R${Math.round(n).toLocaleString('en-ZA').replace(/,/g, ' ')}`;
  return <View style={styles.card} testID="service-support">
    <Text accessibilityRole="header" style={styles.title}>{t('service.title')}</Text>
    {failed ? <Pressable accessibilityRole="button" onPress={load} style={styles.row}>
        <Text style={styles.body}>{t('service.unavailable')}</Text><Text style={styles.link}>{t('common.retry')}</Text>
      </Pressable>
      : !s ? <Text style={styles.body}>{t('common.loading')}</Text> : <>
        <Text style={styles.body} testID="service-status">{t('service.status', { status: t(`service.status.${s.status}` as TranslationKey) })}</Text>
        {s.payer ? <Text style={styles.body} testID="service-payer">{t('service.payer', { payer: s.payer })}</Text> : null}
        {s.planDescription ? <Text style={styles.body}>{t('service.plan', { plan: s.planDescription })}</Text> : null}
        <Text style={styles.help} testID="service-example">
          {t('service.example', { install: amount(s.example.installationZar), monthly: amount(s.example.monthlyZar), zones: s.example.zones })}
        </Text>
        <Text style={styles.help}>{t('service.noPayments')}</Text>
        <Text style={styles.label}>{t('service.helpTitle')}</Text>
        <Text style={styles.help}>{t('service.helpInApp')}</Text>
        <Text style={styles.help}>{t('service.helpTelegram')}</Text>
        {s.contactName ? <Text style={styles.help}>{t('service.contact', { name: s.contactName })}</Text> : null}
      </>}
    <Pressable accessibilityRole="link" onPress={() => router.push('/legal?doc=terms' as never)} style={styles.linkRow} testID="service-terms">
      <Text style={styles.link}>{t('terms.read', { title: t('terms.doc.terms') })}</Text>
    </Pressable>
    <Pressable accessibilityRole="link" onPress={() => router.push('/legal?doc=privacy' as never)} style={styles.linkRow} testID="service-privacy">
      <Text style={styles.link}>{t('terms.read', { title: t('terms.doc.privacy') })}</Text>
    </Pressable>
  </View>;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    card: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginVertical: Spacing.two },
    title: { color: colors.text, fontSize: Type.title, fontWeight: '700' },
    label: { color: colors.text, fontSize: Type.body, fontWeight: '600', marginTop: Spacing.one },
    body: { color: colors.text, fontSize: Type.body, lineHeight: 22, flexShrink: 1 },
    help: { color: colors.textSecondary, fontSize: Type.caption, lineHeight: 20 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two, minHeight: 48 },
    linkRow: { minHeight: 44, justifyContent: 'center' },
    link: { color: colors.primaryDark, fontSize: Type.body, fontWeight: '600', textDecorationLine: 'underline' },
  });
}
