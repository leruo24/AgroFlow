import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { createScreenHeaderStyles } from '@/styles/screenHeaderStyles';
import { AccountAvatar } from './AccountAvatar';
export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createScreenHeaderStyles(colors), [colors]);
  return <View style={styles.container}>
    <View style={styles.titleColumn}><Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View><AccountAvatar />
  </View>;
}
