import { AppAlert as Alert } from '@/components/AppAlert';
import { router } from '@/lib/router';
import { HelpButton } from '@/components/HelpButton';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';

import type { Farm } from '@/context/AgroFlowContext';
import {
  createFarmerServiceRequest,
  fetchFarmerDashboard,
} from '@/services/agroFlowApi';
import { useTheme } from '@/context/ThemeContext';
import { createServiceRequestStyles } from '@/styles/serviceRequestStyles';
import { useBottomPadding } from '@/hooks/useScreenPadding';
import { useI18n, type TranslationKey } from '@/i18n';

type RequestType = 'new_farm' | 'new_zone';

type CropType =
  | 'potato'
  | 'tomato'
  | 'citrus'
  | 'leafy_veg'
  | 'maize'
  | 'dry_beans';

const cropOptions: {
  value: CropType;
  label: string;
}[] = [
  { value: 'potato', label: 'Potato' },
  { value: 'tomato', label: 'Tomato' },
  { value: 'citrus', label: 'Citrus' },
  { value: 'leafy_veg', label: 'Leafy vegetables' },
  { value: 'maize', label: 'Maize' },
  { value: 'dry_beans', label: 'Dry beans' },
];

export default function ServiceRequestScreen() {
  const { t } = useI18n();
  // The floating tab bar (if any), the bottom safe area and 16 below the last control.
  const bottomPad = useBottomPadding(false);
  const { colors } = useTheme();

  const styles = useMemo(
    () => createServiceRequestStyles(colors),
    [colors]
  );

  const [requestType, setRequestType] =
    useState<RequestType>('new_farm');

  const [farms, setFarms] = useState<Farm[]>([]);
  const [selectedFarmId, setSelectedFarmId] =
    useState<string>('');

  const [location, setLocation] = useState('');
  const [roughSize, setRoughSize] = useState('');
  // AF-19: the size always has a unit, or is honestly "I don't know".
  const [sizeUnit, setSizeUnit] = useState<'m2' | 'ha' | 'unknown' | null>(null);
  const [cropType, setCropType] =
    useState<CropType | ''>('');
  const [notes, setNotes] = useState('');

  const [farmsLoading, setFarmsLoading] =
    useState(false);

  const [submitting, setSubmitting] =
    useState(false);

  useEffect(() => {
    async function loadFarms() {
      setFarmsLoading(true);

      try {
        const dashboard =
          await fetchFarmerDashboard();

        const farmRows =
          dashboard.farms as Array<{
            farm_id: string | number;
            owner_id: string;
            name?: string | null;
            location?: string | null;
            total_area?: string | number | null;
            status?: string | null;
            latitude?: string | number | null;
            longitude?: string | number | null;
          }>;

        const availableFarms: Farm[] =
          farmRows.map((farm) => ({
            id: String(farm.farm_id),
            ownerId: farm.owner_id,
            name:
              farm.name?.trim() ||
              'Unnamed farm',
            location:
              farm.location?.trim() || '',
            totalArea:
              farm.total_area == null
                ? null
                : Number(farm.total_area),
            status:
              farm.status || 'Unknown',
            latitude:
              farm.latitude == null
                ? null
                : Number(farm.latitude),
            longitude:
              farm.longitude == null
                ? null
                : Number(farm.longitude),
          }));

        setFarms(availableFarms);

        if (availableFarms.length > 0) {
          setSelectedFarmId(
            availableFarms[0].id
          );
        }
      } catch (error) {
        console.error(
          'Could not load farms:',
          error
        );
      } finally {
        setFarmsLoading(false);
      }
    }

    loadFarms();
  }, []);

  function resetForm() {
    setLocation('');
    setRoughSize('');
    setSizeUnit(null);
    setCropType('');
    setNotes('');
  }

  async function handleSubmit() {
    if (
      requestType === 'new_zone' &&
      !selectedFarmId
    ) {
      Alert.alert(
        t('request.farmRequiredTitle'),
        t('request.farmRequired')
      );
      return;
    }

    if (
      requestType === 'new_farm' &&
      !location.trim()
    ) {
      Alert.alert(
        t('request.locationRequiredTitle'),
        t('request.locationRequired')
      );
      return;
    }

    const parsedSize =
      sizeUnit === 'unknown' || roughSize.trim() === ''
        ? undefined
        : Number(roughSize.replace(',', '.'));

    if (parsedSize !== undefined && sizeUnit === null) {
      Alert.alert(t('request.sizeUnitTitle'), t('request.sizeUnitNeeded'));
      return;
    }

    if (
      parsedSize !== undefined &&
      (!Number.isFinite(parsedSize) ||
        parsedSize <= 0)
    ) {
      Alert.alert(
        t('request.invalidSizeTitle'),
        t('request.invalidSize')
      );
      return;
    }

    if (!cropType) {
      Alert.alert(
        t('request.cropRequiredTitle'),
        t('request.cropRequired')
      );
      return;
    }

    setSubmitting(true);

    try {
      await createFarmerServiceRequest({
        requestType,
        farmId:
          requestType === 'new_zone'
            ? Number(selectedFarmId)
            : undefined,
        location:
          requestType === 'new_farm'
            ? location.trim()
            : undefined,
        roughSize: parsedSize,
        roughSizeUnit: sizeUnit === 'unknown' ? 'unknown' : parsedSize !== undefined ? sizeUnit ?? undefined : undefined,
        cropType,
        notes:
          notes.trim() || undefined,
      });

      Alert.alert(
        t('request.submittedTitle'),
        t('request.submitted'),
        [
          {
            text: 'Done',
            onPress: () => {
              resetForm();
              router.back();
            },
          },
        ]
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Something went wrong while submitting your request.';

      Alert.alert(
        t('request.failedTitle'),
        message
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={['top']}
    >
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={
          Platform.OS === 'ios'
            ? 'padding'
            : undefined
        }
      >
        <ScrollView
          style={styles.page}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Pressable
              onPress={() => router.back()}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
            >
              <ChevronLeft size={24} strokeWidth={2} />
            </Pressable>

            <View style={styles.headerText}>
              <Text style={styles.title}>
                {t('request.title')}
              </Text>
              <Text style={styles.subtitle}>
                {t('request.subtitle')}
              </Text>
            </View>

            <HelpButton screen="farmRequests" />
          </View>

          <Text style={styles.sectionTitle}>
            {t('request.type')}
          </Text>

          <View accessibilityRole="radiogroup" accessibilityLabel={t('request.type')} style={styles.optionGroup}>
            <Pressable
              style={[
                styles.option,
                requestType === 'new_farm' &&
                  styles.optionSelected,
              ]}
              onPress={() => {
                setRequestType('new_farm');
                setSelectedFarmId('');
              }}
              accessibilityRole="radio" aria-checked={requestType === 'new_farm'}
              accessibilityState={{
                checked:
                  requestType === 'new_farm',
              }}
            >
              <Text
                style={styles.optionTitle}
              >
                {t('request.newFarm')}
              </Text>
              <Text
                style={styles.optionDescription}
              >
                {t('request.newFarmBody')}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.option,
                requestType === 'new_zone' &&
                  styles.optionSelected,
              ]}
              onPress={() =>
                setRequestType('new_zone')
              }
              accessibilityRole="radio" aria-checked={requestType === 'new_zone'}
              accessibilityState={{
                checked:
                  requestType === 'new_zone',
              }}
            >
              <Text
                style={styles.optionTitle}
              >
                {t('request.newZone')}
              </Text>
              <Text
                style={styles.optionDescription}
              >
                {t('request.newZoneBody')}
              </Text>
            </Pressable>
          </View>

          {requestType === 'new_zone' ? (
            <>
              <Text style={styles.sectionTitle}>
                {t('request.existingFarm')}
              </Text>

              {farmsLoading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator
                    color={colors.primary}
                  />
                  <Text
                    style={styles.loadingText}
                  >
                    {t('request.loadingFarms')}
                  </Text>
                </View>
              ) : farms.length === 0 ? (
                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>
                    {t('request.noFarms')}
                  </Text>
                </View>
              ) : (
                <View accessibilityRole="radiogroup" accessibilityLabel={t('request.existingFarm')} style={styles.optionGroup}>
                  {farms.map((farm) => {
                    const selected =
                      selectedFarmId ===
                      farm.id;

                    return (
                      <Pressable
                        key={farm.id}
                        style={[
                          styles.farmOption,
                          selected &&
                            styles.optionSelected,
                        ]}
                        onPress={() =>
                          setSelectedFarmId(
                            farm.id
                          )
                        }
                        accessibilityRole="radio" aria-checked={selected}
                        accessibilityState={{
                          checked: selected,
                        }}
                      >
                        <Text
                          style={
                            styles.optionTitle
                          }
                        >
                          {farm.name}
                        </Text>

                        {farm.location ? (
                          <Text
                            style={
                              styles.optionDescription
                            }
                          >
                            {farm.location}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          ) : null}

          {requestType === 'new_farm' ? (
            <>
              <Text style={styles.sectionTitle}>
                {t('request.location')}
              </Text>

              <TextInput
                style={styles.input}
                value={location}
                onChangeText={setLocation}
                placeholder={t('request.locationPlaceholder')}
                placeholderTextColor={
                  colors.textMuted
                }
                autoCapitalize="sentences"
                returnKeyType="next"
              />
            </>
          ) : null}

          <Text style={styles.sectionTitle}>
            {t('request.sizeLabel')}
          </Text>

          <TextInput
            style={[styles.input, sizeUnit === 'unknown' && { opacity: 0.5 }]}
            value={sizeUnit === 'unknown' ? '' : roughSize}
            onChangeText={setRoughSize}
            editable={sizeUnit !== 'unknown'}
            placeholder={t('request.sizePlaceholder')}
            placeholderTextColor={
              colors.textMuted
            }
            keyboardType="decimal-pad"
            accessibilityLabel={t('request.sizeLabel')}
            testID="request-size"
          />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={t('request.sizeUnitLabel')}>
            {(['m2', 'ha', 'unknown'] as const).map(unit => {
              const on = sizeUnit === unit;
              return <Pressable key={unit} accessibilityRole="radio" aria-checked={on} accessibilityState={{ checked: on }}
                onPress={() => setSizeUnit(unit)} testID={`request-size-unit-${unit}`}
                style={[styles.input, { flexGrow: 1, minWidth: 96, justifyContent: 'center', alignItems: 'center' },
                  on && { borderColor: colors.primaryDark, borderWidth: 2 }]}>
                <Text style={{ color: colors.text, fontWeight: on ? '700' : '400' }}>{t(`request.sizeUnit.${unit}` as TranslationKey)}</Text>
              </Pressable>;
            })}
          </View>

          <Text style={styles.helperText}>
            {sizeUnit === 'unknown' ? t('request.sizeUnknownHelp') : t('request.sizeHelp')}
          </Text>

          <Text style={styles.sectionTitle}>
            {t('request.crop')}
          </Text>

          <View accessibilityRole="radiogroup" accessibilityLabel={t('request.crop')} style={styles.cropGrid}>
            {cropOptions.map((crop) => {
              const selected =
                cropType === crop.value;

              return (
                <Pressable
                  key={crop.value}
                  style={[
                    styles.cropOption,
                    selected &&
                      styles.cropSelected,
                  ]}
                  onPress={() =>
                    setCropType(crop.value)
                  }
                  accessibilityRole="radio" aria-checked={selected}
                  accessibilityState={{
                    checked: selected,
                  }}
                >
                  <Text
                    style={
                      styles.cropText
                    }
                  >
                    {crop.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>
            {t('request.notesLabel')}
          </Text>

          <TextInput
            style={[
              styles.input,
              styles.notesInput,
            ]}
            value={notes}
            onChangeText={setNotes}
            placeholder={t('request.notesPlaceholder')}
            placeholderTextColor={
              colors.textMuted
            }
            multiline
            textAlignVertical="top"
          />

          <Pressable
            style={[
              styles.submitButton,
              submitting &&
                styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator
                color={colors.white}
              />
            ) : (
              <Text
                style={styles.submitText}
              >
                {t('request.submit')}
              </Text>
            )}
          </Pressable>

          <Text style={styles.footerNote}>
            {t('request.pendingNote')}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}