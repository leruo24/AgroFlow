import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View, Platform } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { BlurSheet } from '@/components/BlurSheet';
import { createTodayStyles } from '@/styles/todayStyles';
import type { DismissView } from '@/lib/dismissals';
import { Space } from '@/constants/colors';
import { useI18n } from '@/i18n';

// The app's dismiss pieces: the x button, the Active / Dismissed / All switch, the
// 5-second Undo bar, and the note sheet a critical item asks for.

export function DismissButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Dismiss: ${label}`} hitSlop={10} onPress={onPress}
      style={{ paddingHorizontal: Space.sm, paddingVertical: 2 }}>
      <Text style={{ fontSize: 20, lineHeight: 22, color: colors.textMuted }}>×</Text>
    </Pressable>
  );
}

export function ViewSwitch({ value, onChange }: { value: DismissView; onChange: (v: DismissView) => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);
  const options: [DismissView, string][] = [['active', t('visual.active')], ['dismissed', t('visual.dismissed')], ['all', t('visual.all')]];
  return (
    <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={t('dismiss.show')}>
      {options.map(([v, label]) => (
        <Pressable key={v} accessibilityRole="radio" aria-checked={value === v} accessibilityState={{ selected: value === v, checked: value === v }}
          onPress={() => onChange(v)} style={[styles.choice, { minHeight: Platform.OS === 'web' ? 44 : 36, minWidth: 0 }, value === v && styles.choiceSelected]}>
          <Text style={styles.choiceText}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Shows `message` with Undo for 5 s; Undo runs once. */
export function UndoBar({ message, onUndo, onDone }: { message: string | null; onUndo: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const used = useRef(false);
  useEffect(() => {
    if (!message) return;
    used.current = false;
    const timer = setTimeout(onDone, 5000);
    return () => clearTimeout(timer);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.text, borderRadius: 8, paddingHorizontal: Space.md, paddingVertical: Space.sm, marginVertical: Space.sm }}>
      <Text style={{ color: colors.white, flex: 1 }}>{message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('dismiss.undo')} onPress={() => {
        if (used.current) return;
        used.current = true;
        onUndo();
        onDone();
      }}>
        <Text style={{ color: colors.primary, fontWeight: '700', paddingLeft: Space.md }}>{t('dismiss.undo')}</Text>
      </Pressable>
    </View>
  );
}

/** A critical item: an optional note before it is dismissed. */
export function DismissNoteSheet({ title, visible, onCancel, onConfirm }: {
  title: string; visible: boolean; onCancel: () => void; onConfirm: (note: string | null) => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);
  const [note, setNote] = useState('');
  useEffect(() => { if (visible) setNote(''); }, [visible]);
  return (
    <BlurSheet visible={visible} onClose={onCancel} title={t('dismiss.title')}>
      <View style={styles.sheet}>
        <Text style={styles.intro}>{title}</Text>
        <Text style={styles.help}>{t('dismiss.important')}</Text>
        <TextInput accessibilityLabel={t('dismiss.note')} placeholder={t('dismiss.note')} placeholderTextColor={colors.textMuted}
          value={note} onChangeText={setNote} maxLength={500} style={styles.input} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('dismiss.confirmA11y')} onPress={() => onConfirm(note.trim() || null)} style={styles.button}>
          <Text style={styles.buttonText}>{t('dismiss.confirm')}</Text>
        </Pressable>
      </View>
    </BlurSheet>
  );
}
