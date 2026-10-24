// "Reconnect or reset your kit": the one guide for a farmer whose Wi-Fi changed, a kit that has to
// move, and the full reset. Every step is what firmware 1.7.1 already does (AgroFlowIrrigationNode.ino):
// 3 quick power cycles or 15 minutes without its Wi-Fi open the setup page and keep the farm link;
// 5 quick power cycles wipe the Wi-Fi and the enrollment. Opened from the Kit tab and the field guide.
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { useI18n } from '@/i18n';

// The printable one-page guide, in this site's public/ folder (the staff site has the same file).
export const KIT_GUIDE_PATH = '/guides/reconnect-or-reset-your-kit.html';
export const SETUP_PAGE_ADDRESS = '192.168.4.1';

export function KitHelpGuide({ networkName, password, testID = 'kit-help' }: {
  networkName?: string | null; password?: string | null; testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const { t } = useI18n();
  const known = !!networkName && !!password;
  const heading = { color: colors.text, fontSize: 20, fontWeight: '700' as const, marginTop: 20 };
  const body = { color: colors.text, fontSize: 16, lineHeight: 24, marginTop: 8 };
  const step = (n: number, text: string, id: string) => <View key={id} style={{ flexDirection: 'row', gap: 8, marginTop: 8 }} testID={`${testID}-${id}`}>
    <Text style={[body, { marginTop: 0, fontWeight: '700' }]}>{n}.</Text>
    <Text style={[body, { marginTop: 0, flex: 1 }]}>{text}</Text>
  </View>;

  return <>
    <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={{ minHeight: 48, justifyContent: 'center' }} testID={`${testID}-open`}>
      <Text style={{ color: colors.primaryDark, fontSize: 16, fontWeight: '600' }}>{t('kitHelp.open')}</Text>
    </Pressable>
    <Modal visible={open} onRequestClose={() => setOpen(false)} animationType="none" presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View role="dialog" accessibilityLabel={t('kitHelp.title')} accessibilityViewIsModal style={{ flex: 1, padding: 16 }} testID={`${testID}-guide`}>
          <Text accessibilityRole="header" style={{ fontSize: 26, color: colors.text, fontWeight: '700' }}>{t('kitHelp.title')}</Text>
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={{ minHeight: 48, justifyContent: 'center' }} testID={`${testID}-close`}>
            <Text style={{ color: colors.primaryDark, fontSize: 18 }}>{t('common.back')}</Text>
          </Pressable>
          <ScrollView>
            <View testID={`${testID}-wifi`}>
              <Text accessibilityRole="header" style={heading}>{t('kitHelp.wifiTitle')}</Text>
              <Text style={body}>{t('kitHelp.wifiWays')}</Text>
              <Text style={body}>• {t('kitHelp.wifiWayApp')}</Text>
              <Text style={body}>• {t('kitHelp.wifiWayPower')}</Text>
              <Text style={body}>• {t('kitHelp.wifiWayWait')}</Text>
              <Text style={[body, { fontWeight: '600' }]}>{t('kitHelp.wifiThen')}</Text>
              {step(1, known ? t('kitHelp.wifiJoinKnown', { name: networkName!, password: password! }) : t('kitHelp.wifiJoin'), 'step-join')}
              {step(2, t('kitHelp.wifiPage', { address: SETUP_PAGE_ADDRESS }), 'step-page')}
              {step(3, t('kitHelp.wifiSave'), 'step-save')}
              <Text style={body}>{t('kitHelp.wifiKeep')}</Text>
            </View>
            <View testID={`${testID}-move`}>
              <Text accessibilityRole="header" style={heading}>{t('kitHelp.moveTitle')}</Text>
              <Text style={body}>{t('kitHelp.moveBody')}</Text>
            </View>
            <View testID={`${testID}-reset`}>
              <Text accessibilityRole="header" style={heading}>{t('kitHelp.resetTitle')}</Text>
              <Text style={body}>{t('kitHelp.resetHow')}</Text>
              <View style={{ marginTop: 8, padding: 12, borderRadius: 8, borderWidth: 2, borderColor: colors.error, backgroundColor: colors.surface }}>
                <Text style={[body, { marginTop: 0, fontWeight: '700', color: colors.error }]} testID={`${testID}-reset-warning`}>{t('kitHelp.resetWarn')}</Text>
              </View>
            </View>
            {/* The printable page lives on the web app's own site; a phone app has no address for it. */}
            {Platform.OS === 'web' ? <Pressable accessibilityRole="link" style={{ minHeight: 48, justifyContent: 'center', marginTop: 16 }} testID={`${testID}-print`}
              onPress={() => { window.open(KIT_GUIDE_PATH, '_blank', 'noopener'); }}>
              <Text style={{ color: colors.primaryDark, fontSize: 16, fontWeight: '600' }}>{t('kitHelp.print')}</Text>
            </Pressable> : null}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  </>;
}
