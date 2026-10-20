// One-tap sign-in: the "Sign in to AgroFlow" button in the Telegram welcome opens
// /signin?token=... (docs/password-reset.md). The API swaps the token (once, 24 hours) for a
// Supabase magic-link token hash, and verifyOtp turns that into a session here. Then the
// setup wizard, which starts with choosing an own password. If anything fails, the farmer
// still has the temporary password from the same message.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/context/ThemeContext';
import { useI18n } from '@/i18n';
import { router } from '@/lib/router';
import { tokenFromParams } from '@/lib/signInHelp';
import { supabase } from '@/lib/supabase';
import { redeemOneTap } from '@/services/agroFlowApi';
import { Space } from '@/constants/colors';

export default function OneTapSignInScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = tokenFromParams(params.token);
  const [failed, setFailed] = useState(token === null);
  const started = useRef(false);

  useEffect(() => {
    // Once: the token works once, and a second render must not spend it again.
    if (!token || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const { tokenHash } = await redeemOneTap(token);
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
        if (error) throw error;
        router.replace('/setup' as never);
      } catch {
        setFailed(true);
      }
    })();
  }, [token]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.xl, gap: Space.lg }}>
        {failed ? (
          <>
            <Text testID="onetap-failed" style={{ color: colors.text, fontSize: 17, textAlign: 'center', lineHeight: 24 }}>
              {t('onetap.failed')}
            </Text>
            <TouchableOpacity
              testID="onetap-login"
              accessibilityRole="button"
              onPress={() => router.replace('/login')}
              style={{ backgroundColor: colors.primaryDark, borderRadius: 12, paddingVertical: Space.md, paddingHorizontal: Space.xl, minHeight: 48 }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{t('onetap.toLogin')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={colors.primaryDark} />
            <Text testID="onetap-busy" style={{ color: colors.text, fontSize: 17 }}>{t('onetap.signingIn')}</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
