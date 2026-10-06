// "Ask for a call" - reached from the login screen by someone who is not a
// farmer on AgroFlow yet (item 6c). No login: it posts to the same public
// endpoint as the website's form, which checks everything again.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { router } from '@/lib/router';
import { useTheme } from '@/context/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { createTodayStyles } from '@/styles/todayStyles';
import { submitEnquiry, type EnquiryInput } from '@/services/agroFlowApi';
import { ZONE_CROPS } from '@/lib/setupHelpers';
import { CONSENT_TEXT, PROVINCES, TIMES, enquiryProblem } from '@/lib/enquiryForm';

export default function EnquiryScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);

  const [form, setForm] = useState<EnquiryInput>({
    fullName: '', phone: '', email: null, province: '', town: '', farmSizeHa: null,
    crops: [], cropsOther: null, bestTime: 'morning', notes: null, consent: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);

  const set = <K extends keyof EnquiryInput>(key: K, value: EnquiryInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleCrop = (c: string) =>
    setForm((f) => ({ ...f, crops: f.crops.includes(c) ? f.crops.filter((x) => x !== c) : [...f.crops, c] }));

  const send = useCallback(() => {
    const problem = enquiryProblem(form);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    submitEnquiry(form)
      .then((r) => setThanks(r.message))
      .catch((e: unknown) => setError(e instanceof Error && e.message ? e.message : 'The enquiry could not be sent.'))
      .finally(() => setBusy(false));
  }, [form]);

  const field = (label: string, key: 'fullName' | 'phone' | 'email' | 'town', props: object = {}) => (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={(form[key] as string | null) ?? ''}
        onChangeText={(t) => set(key, (key === 'email' ? t || null : t) as never)}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        {...props}
      />
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={{ padding: 12 }}>
          <ArrowLeft size={22} color={colors.text} strokeWidth={1.8} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <ScreenHeader title="Ask for a call" subtitle="A representative will phone you about AgroFlow." />
        </View>
      </View>

      {thanks ? (
        <View style={{ padding: 16 }}>
          <Text style={styles.action} accessibilityLiveRegion="polite">{thanks}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          {field('Full name *', 'fullName', { autoComplete: 'name' })}
          {field('Phone number *', 'phone', { keyboardType: 'phone-pad', placeholder: '082 123 4567' })}
          {field('Email (optional)', 'email', { keyboardType: 'email-address', autoCapitalize: 'none' })}

          <Text style={styles.label}>Province *</Text>
          <View style={styles.choices}>
            {PROVINCES.map((p) => (
              <Pressable key={p} accessibilityRole="radio" accessibilityState={{ selected: form.province === p }}
                onPress={() => set('province', p)} style={[styles.choice, form.province === p && styles.choiceSelected]}>
                <Text style={styles.choiceText}>{p}</Text>
              </Pressable>
            ))}
          </View>

          {field('Town *', 'town')}

          <View style={{ gap: 4 }}>
            <Text style={styles.label}>Farm size in hectares (optional)</Text>
            <TextInput accessibilityLabel="Farm size in hectares" keyboardType="decimal-pad" style={styles.input}
              value={form.farmSizeHa == null ? '' : String(form.farmSizeHa)}
              onChangeText={(t) => set('farmSizeHa', Number(t.replace(',', '.')) > 0 ? Number(t.replace(',', '.')) : null)} />
          </View>

          <Text style={styles.label}>What do you grow, or want to grow? *</Text>
          <View style={styles.choices}>
            {[...ZONE_CROPS, { value: 'other', label: 'Other' }].map((c) => (
              <Pressable key={c.value} accessibilityRole="checkbox" accessibilityState={{ checked: form.crops.includes(c.value) }}
                onPress={() => toggleCrop(c.value)} style={[styles.choice, form.crops.includes(c.value) && styles.choiceSelected]}>
                <Text style={styles.choiceText}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
          {form.crops.includes('other') && (
            <TextInput accessibilityLabel="Which other crop?" placeholder="Which other crop?" placeholderTextColor={colors.textMuted}
              style={styles.input} value={form.cropsOther ?? ''} onChangeText={(t) => set('cropsOther', t || null)} />
          )}

          <Text style={styles.label}>Best time to call *</Text>
          <View style={styles.choices}>
            {TIMES.map((t) => (
              <Pressable key={t} accessibilityRole="radio" accessibilityState={{ selected: form.bestTime === t }}
                onPress={() => set('bestTime', t)} style={[styles.choice, form.bestTime === t && styles.choiceSelected]}>
                <Text style={styles.choiceText}>{t[0].toUpperCase() + t.slice(1)}</Text>
              </Pressable>
            ))}
          </View>

          <TextInput accessibilityLabel="Anything else?" placeholder="Anything else? (optional)" placeholderTextColor={colors.textMuted}
            multiline style={[styles.input, { minHeight: 80 }]} value={form.notes ?? ''} onChangeText={(t) => set('notes', t || null)} />

          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: form.consent }}
            onPress={() => set('consent', !form.consent)} style={[styles.choice, form.consent && styles.choiceSelected, { alignItems: 'flex-start' }]}>
            <Text style={styles.choiceText}>{form.consent ? '☑ ' : '☐ '}{CONSENT_TEXT} *</Text>
          </Pressable>

          {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}

          <Pressable accessibilityRole="button" accessibilityLabel="Send enquiry" disabled={busy}
            onPress={send} style={[styles.button, busy && styles.busy]}>
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Send</Text>}
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
