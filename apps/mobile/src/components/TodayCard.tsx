import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { router } from '@/lib/router';
import { createTodayStyles } from '@/styles/todayStyles';
import { WhyLink } from '@/components/WhySheet';
import { ManualLogSheet } from '@/components/ManualLogSheet';
import type { TodayZone } from '@/services/agroFlowApi';

const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

type Props = {
  zone: TodayZone;
  onLogged: () => void;
};

// Item 6: one card per zone on Home - today's one action, how sure, and
// one tap to say "I watered". The text is the server's; nothing is
// worked out here.
export function TodayCard({ zone, onLogged }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);
  const [sheet, setSheet] = useState<'water' | 'feel' | null>(null);

  const actionStyle =
    zone.action.kind === 'water' ? styles.actionWater : zone.action.kind === 'kit' ? styles.actionKit : null;

  return (
    <View style={styles.card} testID={`today-${zone.zoneId}`}>
      <Text style={styles.zoneName}>{zone.name}</Text>
      <Text style={[styles.action, actionStyle]}>{zone.action.text}</Text>
      <WhyLink explanation={zone.why} compact />

      {zone.confidence && (
        <View
          style={styles.badgeRow}
          accessibilityLabel={`Advice confidence: ${LEVEL_LABEL[zone.confidence.level]}. ${zone.confidence.reason}`}
        >
          <Text style={styles.badge}>{LEVEL_LABEL[zone.confidence.level]} confidence</Text>
          <WhyLink explanation={zone.confidenceExplanation} compact />
        </View>
      )}

      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" onPress={() => setSheet('water')} style={styles.button}>
          <Text style={styles.buttonText}>I watered</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setSheet('feel')} style={styles.ghost}>
          <Text style={styles.ghostText}>How does the soil feel?</Text>
        </Pressable>
        {zone.nextStep && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Finish setup for ${zone.name}`}
            onPress={() => router.push({ pathname: '/zone-setup', params: { zoneId: String(zone.zoneId) } })}
            style={styles.ghost}
          >
            <Text style={styles.ghostText}>Finish setup</Text>
          </Pressable>
        )}
      </View>

      <ManualLogSheet
        zoneId={zone.zoneId}
        zoneName={zone.name}
        mode={sheet}
        onClose={() => setSheet(null)}
        onSaved={onLogged}
      />
    </View>
  );
}
