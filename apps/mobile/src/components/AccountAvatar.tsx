import { useMemo } from 'react';
import { router } from '@/lib/router';
import { Pressable, Text } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { createAccountAvatarStyles } from '@/styles/accountAvatarStyles';

export function AccountAvatar() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createAccountAvatarStyles(colors), [colors]);
  const initials = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .map((part) => part!.trim().charAt(0))
    .join('')
    .toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'AF';

  return (
    <Pressable
      onPress={() => router.push('/profile')}
      accessibilityRole="button"
      accessibilityLabel="Open profile"
      style={styles.avatar}
    >
      <Text style={styles.initials}>{initials}</Text>
    </Pressable>
  );
}
