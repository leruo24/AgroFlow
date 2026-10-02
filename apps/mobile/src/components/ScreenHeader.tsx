import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { createScreenHeaderStyles } from '@/styles/screenHeaderStyles';
import { AccountAvatar } from './AccountAvatar';
import { HelpButton } from './HelpButton';
import type { HelpScreen } from '@/constants/helpContent';
import { sharedLayout } from '@/styles/shared';

// `help` is optional so that adding page help to a screen is a one-word change
// here rather than a restructured header there. The button sits to the left of
// the account avatar, and disappears entirely when the farmer turns page help
// off in Settings.
export function ScreenHeader({
  title,
  subtitle,
  help,
}: {
  title: string;
  subtitle?: string;
  help?: HelpScreen;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createScreenHeaderStyles(colors), [colors]);
  return <View style={styles.container}>
    <View style={styles.titleColumn}><Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
    <View style={sharedLayout.inlineRow}>
      {help && <HelpButton screen={help} />}
      <AccountAvatar />
    </View>
  </View>;
}
