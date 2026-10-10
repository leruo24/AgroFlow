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
    setCropType('');
    setNotes('');
  }

  async function handleSubmit() {
    if (
      requestType === 'new_zone' &&
      !selectedFarmId
    ) {
      Alert.alert(
        'Farm required',
        'Please select the farm where the new zone should be created.'
      );
      return;
    }

    if (
      requestType === 'new_farm' &&
      !location.trim()
    ) {
      Alert.alert(
        'Location required',
        'Please enter the location of the new farm.'
      );
      return;
    }

    const parsedSize =
      roughSize.trim() === ''
        ? undefined
        : Number(roughSize);

    if (
      parsedSize !== undefined &&
      (!Number.isFinite(parsedSize) ||
        parsedSize <= 0)
    ) {
      Alert.alert(
        'Invalid size',
        'Rough size must be a number greater than zero.'
      );
      return;
    }

    if (!cropType) {
      Alert.alert(
        'Crop required',
        'Please select the main crop for this request.'
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
        cropType,
        notes:
          notes.trim() || undefined,
      });

      Alert.alert(
        'Request submitted',
        'Your request has been submitted and is now pending admin review.',
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
        'Request failed',
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
          contentContainerStyle={
            styles.scrollContent
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Pressable
              onPress={() => router.back()}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ChevronLeft size={24} strokeWidth={2} />
            </Pressable>

            <View style={styles.headerText}>
              <Text style={styles.title}>
                Farm request
              </Text>
              <Text style={styles.subtitle}>
                Request a new farm or zone from AgroFlow.
              </Text>
            </View>

            <HelpButton screen="farmRequests" />
          </View>

          <Text style={styles.sectionTitle}>
            Request type
          </Text>

          <View style={styles.optionGroup}>
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
              accessibilityRole="radio"
              accessibilityState={{
                checked:
                  requestType === 'new_farm',
              }}
            >
              <Text
                style={styles.optionTitle}
              >
                New farm
              </Text>
              <Text
                style={styles.optionDescription}
              >
                Request installation for a new farm.
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
              accessibilityRole="radio"
              accessibilityState={{
                checked:
                  requestType === 'new_zone',
              }}
            >
              <Text
                style={styles.optionTitle}
              >
                New zone
              </Text>
              <Text
                style={styles.optionDescription}
              >
                Request an additional zone on an existing farm.
              </Text>
            </Pressable>
          </View>

          {requestType === 'new_zone' ? (
            <>
              <Text style={styles.sectionTitle}>
                Existing farm
              </Text>

              {farmsLoading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator
                    color={colors.primary}
                  />
                  <Text
                    style={styles.loadingText}
                  >
                    Loading your farms...
                  </Text>
                </View>
              ) : farms.length === 0 ? (
                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>
                    No existing farms are available for a new-zone request.
                  </Text>
                </View>
              ) : (
                <View style={styles.optionGroup}>
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
                        accessibilityRole="radio"
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
                Farm location
              </Text>

              <TextInput
                style={styles.input}
                value={location}
                onChangeText={setLocation}
                placeholder="Enter the farm location"
                placeholderTextColor={
                  colors.textMuted
                }
                autoCapitalize="sentences"
                returnKeyType="next"
              />
            </>
          ) : null}

          <Text style={styles.sectionTitle}>
            Rough size
          </Text>

          <TextInput
            style={styles.input}
            value={roughSize}
            onChangeText={setRoughSize}
            placeholder="e.g. 2.5"
            placeholderTextColor={
              colors.textMuted
            }
            keyboardType="decimal-pad"
          />

          <Text style={styles.helperText}>
            Enter an approximate size. The unit can be confirmed during installation.
          </Text>

          <Text style={styles.sectionTitle}>
            Crop
          </Text>

          <View style={styles.cropGrid}>
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
                  accessibilityRole="radio"
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
            Notes
          </Text>

          <TextInput
            style={[
              styles.input,
              styles.notesInput,
            ]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional additional information"
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
                Submit request
              </Text>
            )}
          </Pressable>

          <Text style={styles.footerNote}>
            Your request will remain pending until it is reviewed by an AgroFlow administrator.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}