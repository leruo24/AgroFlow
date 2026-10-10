import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { BlurSheet } from '@/components/BlurSheet';
import { createTodayStyles } from '@/styles/todayStyles';
import type { DismissView } from '@/lib/dismissals';

// The app's dismiss pieces: the x button, the Active / Dismissed / All switch, the
// 5-second Undo bar, and the note sheet a critical item asks for.

export function DismissButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Dismiss: ${label}`} hitSlop={10} onPress={onPress}
      style={{ paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ fontSize: 20, lineHeight: 22, color: colors.textMuted }}>×</Text>
    </Pressable>
  );
}

export function ViewSwitch({ value, onChange }: { value: DismissView; onChange: (v: DismissView) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);
  const options: [DismissView, string][] = [['active', 'Active'], ['dismissed', 'Dismissed'], ['all', 'All']];
  return (
    <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel="Show">
      {options.map(([v, label]) => (
        <Pressable key={v} accessibilityRole="radio" accessibilityState={{ selected: value === v }}
          onPress={() => onChange(v)} style={[styles.choice, { minHeight: 36, minWidth: 0 }, value === v && styles.choiceSelected]}>
          <Text style={styles.choiceText}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Shows `message` with Undo for 5 s; Undo runs once. */
export function UndoBar({ message, onUndo, onDone }: { message: string | null; onUndo: () => void; onDone: () => void }) {
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
      backgroundColor: colors.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 8 }}>
      <Text style={{ color: colors.white, flex: 1 }}>{message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Undo" onPress={() => {
        if (used.current) return;
        used.current = true;
        onUndo();
        onDone();
      }}>
        <Text style={{ color: colors.primary, fontWeight: '700', paddingLeft: 12 }}>Undo</Text>
      </Pressable>
    </View>
  );
}

/** A critical item: an optional note before it is dismissed. */
export function DismissNoteSheet({ title, visible, onCancel, onConfirm }: {
  title: string; visible: boolean; onCancel: () => void; onConfirm: (note: string | null) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);
  const [note, setNote] = useState('');
  useEffect(() => { if (visible) setNote(''); }, [visible]);
  return (
    <BlurSheet visible={visible} onClose={onCancel} title="Dismiss this?">
      <View style={styles.sheet}>
        <Text style={styles.intro}>{title}</Text>
        <Text style={styles.help}>It is important. It will come back if it happens again.</Text>
        <TextInput accessibilityLabel="Note (optional)" placeholder="Note (optional)" placeholderTextColor={colors.textMuted}
          value={note} onChangeText={setNote} maxLength={500} style={styles.input} />
        <Pressable accessibilityRole="button" accessibilityLabel="Confirm dismiss" onPress={() => onConfirm(note.trim() || null)} style={styles.button}>
          <Text style={styles.buttonText}>Dismiss</Text>
        </Pressable>
      </View>
    </BlurSheet>
  );
}
