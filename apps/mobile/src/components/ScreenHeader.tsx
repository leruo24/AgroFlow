import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { createScreenHeaderStyles } from '@/styles/screenHeaderStyles';
import { AccountAvatar } from './AccountAvatar';
import { HelpButton } from './HelpButton';
import type { HelpScreen } from '@/constants/helpContent';
import { OfflineBanner } from './OfflineBanner';

// `help` is optional, so adding page help to a screen is a one-word change. The button sits
// left of the account avatar and disappears when page help is turned off in Settings.
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
  // The offline banner sits under every screen's title, so it is on every screen with a header.
  return <>
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>{title}</Text>
        <View style={styles.actions}>
          {help && <HelpButton screen={help} />}
          <AccountAvatar />
        </View>
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
    <OfflineBanner />
  </>;
}
