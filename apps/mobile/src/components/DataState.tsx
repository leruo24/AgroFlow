import { useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react-native';
import { useTheme } from '@/context/ThemeContext';
import { createDataStateStyles } from '@/styles/dataStateStyles';

type Props = { kind: 'loading' | 'empty' | 'error'; title: string; description?: string; onRetry?: () => void };
export function DataState({ kind, title, description, onRetry }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createDataStateStyles(colors), [colors]);
  const Icon = kind === 'error' ? AlertCircle : Inbox;
  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <View style={styles.heading}>
        {kind === 'loading' ? <ActivityIndicator color={colors.primaryDark} /> : <Icon size={21} color={colors.textSecondary} strokeWidth={1.7} />}
        <Text style={styles.title}>{title}</Text>
      </View>
      {description && <Text style={styles.description}>{description}</Text>}
      {onRetry && <Pressable accessibilityRole="button" accessibilityLabel={`Retry: ${title}`} onPress={onRetry} style={styles.retry}>
        <RefreshCw size={18} color={colors.primaryDark} /><Text style={styles.retryText}>Retry</Text>
      </Pressable>}
    </View>
  );
}
