import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import { useAgroFlow } from '@/context/AgroFlowContext';
import { useTheme } from '@/context/ThemeContext';
import { createFarmSelectorStyles } from '@/styles/farmSelectorStyles';
import { BlurSheet } from './BlurSheet';
import { useI18n } from '@/i18n';

export function FarmSelector() {
  const { farm, farms, isFarmLoading, farmError, selectFarm, refreshFarms } = useAgroFlow();
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => createFarmSelectorStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const multiple = farms.length > 1 && !isFarmLoading;
  return <View style={styles.container}>
    <Text style={styles.label}>{t('farm.current')}</Text>
    <Pressable accessibilityRole={multiple || farmError ? 'button' : 'text'}
      accessibilityLabel={farmError ? t('farm.retryA11y') : multiple ? t('farm.selectA11y', { name: farm?.name ?? '' }) : farm?.name || t('farm.none')}
      disabled={isFarmLoading || (!multiple && !farmError)}
      onPress={() => farmError ? refreshFarms() : setOpen(true)}
      style={styles.trigger}>
      <Text style={styles.triggerText}>
        {isFarmLoading ? t('farm.loading') : farmError ? t('farm.unavailable') : farm?.name || t('farm.none')}
      </Text>
      {farm?.isSimulated && <Text style={styles.simulatedBadge}>{t('farm.simulated')}</Text>}
      {multiple && <ChevronDown size={21} color={colors.textSecondary} />}
    </Pressable>
    <BlurSheet visible={open} onClose={() => setOpen(false)} title={t('farm.select')}>
      {farms.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.id === farm?.id }}
        onPress={() => { selectFarm(item.id); setOpen(false); }}
        style={styles.option}>
        <View style={styles.optionTextColumn}><Text style={[styles.optionName, item.id === farm?.id && styles.optionNameSelected]}>{item.name}</Text>
          {!!item.location && <Text style={styles.optionLocation}>{item.location}</Text>}
        </View>
        {item.isSimulated && <Text style={styles.simulatedBadge}>{t('farm.simulated')}</Text>}
        {item.id === farm?.id && <Check size={22} color={colors.primaryDark} />}
      </Pressable>)}
      <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.cancel}><Text style={styles.cancelText}>{t('common.cancel')}</Text></Pressable>
    </BlurSheet>
  </View>;
}
