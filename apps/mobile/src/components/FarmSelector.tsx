import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { createFarmSelectorStyles } from '@/styles/farmSelectorStyles';
import { BlurSheet } from './BlurSheet';

export function FarmSelector() {
  const { farm, farms, isFarmLoading, farmError, selectFarm, refreshFarms } = useAgroFlow();
  const { colors } = useTheme();
  const styles = useMemo(() => createFarmSelectorStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const multiple = farms.length > 1 && !isFarmLoading;
  return <View style={styles.container}>
    <Text style={styles.label}>CURRENT FARM</Text>
    <Pressable accessibilityRole={multiple || farmError ? 'button' : 'text'}
      accessibilityLabel={farmError ? 'Retry loading farms' : multiple ? 'Select farm, current farm ' + farm?.name : farm?.name || 'No farm assigned'}
      disabled={isFarmLoading || (!multiple && !farmError)}
      onPress={() => farmError ? refreshFarms() : setOpen(true)}
      style={styles.trigger}>
      <Text style={styles.triggerText}>
        {isFarmLoading ? 'Loading farm…' : farmError ? 'Farm unavailable · Retry' : farm?.name || 'No farm assigned'}
      </Text>
      {farm?.isSimulated && <Text style={styles.simulatedBadge}>Simulated</Text>}
      {multiple && <ChevronDown size={21} color={colors.textSecondary} />}
    </Pressable>
    <BlurSheet visible={open} onClose={() => setOpen(false)} title="Select a farm">
      {farms.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.id === farm?.id }}
        onPress={() => { selectFarm(item.id); setOpen(false); }}
        style={styles.option}>
        <View style={styles.optionTextColumn}><Text style={[styles.optionName, item.id === farm?.id && styles.optionNameSelected]}>{item.name}</Text>
          {!!item.location && <Text style={styles.optionLocation}>{item.location}</Text>}
        </View>
        {item.isSimulated && <Text style={styles.simulatedBadge}>Simulated</Text>}
        {item.id === farm?.id && <Check size={22} color={colors.primaryDark} />}
      </Pressable>)}
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.cancel}><Text style={styles.cancelText}>Cancel</Text></Pressable>
    </BlurSheet>
  </View>;
}
