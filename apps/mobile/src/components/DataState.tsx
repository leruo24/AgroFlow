import { useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { AlertCircle, Gauge, Inbox, RefreshCw, WifiOff } from 'lucide-react-native';
import { useTheme } from '@/context/ThemeContext';
import { createDataStateStyles } from '@/styles/dataStateStyles';
import { useI18n } from '@/i18n';
import { FieldArtwork } from './visual/FieldArtwork';

type Props = { kind: 'loading' | 'empty' | 'error' | 'stale' | 'value'; title: string; description?: string; onRetry?: () => void };
export function DataState({ kind, title, description, onRetry }: Props) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createDataStateStyles(colors), [colors]);
  const Icon = kind === 'error' ? AlertCircle : kind === 'stale' ? WifiOff : kind === 'value' ? Gauge : Inbox;
  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      {kind === 'empty' && <FieldArtwork color={colors.secondaryDark} />}
      <View style={styles.heading}>
        {kind === 'loading' ? <ActivityIndicator color={colors.primaryDark} /> : <Icon size={21} color={colors.textSecondary} strokeWidth={1.7} />}
        <Text style={styles.title}>{title}</Text>
      </View>
      {description && <Text style={styles.description}>{description}</Text>}
      {onRetry && <Pressable accessibilityRole="button" accessibilityLabel={`${t('common.retry')}: ${title}`} onPress={onRetry} style={styles.retry}>
        <RefreshCw size={18} color={colors.primaryDark} /><Text style={styles.retryText}>{t('common.retry')}</Text>
      </Pressable>}
    </View>
  );
}
