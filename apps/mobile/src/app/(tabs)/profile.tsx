import { AppAlert as Alert } from '@/components/AppAlert';
import { HelpButton } from '@/components/HelpButton';
// Profile screen
import { router } from '@/lib/router';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  SafeAreaView,
} from 'react-native-safe-area-context';

import { FarmSelector } from '@/components/FarmSelector';

import { TelegramSection } from '@/components/TelegramSection';

import {
  useAuth,
} from '@/context/AuthContext';

import {
  useAgroFlow,
} from '@/context/AgroFlowContext';

import {
  useTheme,
} from '@/context/ThemeContext';

import {
  fetchFarmerDashboard,
  updateProfileThroughApi,
} from '@/services/agroFlowApi';

import {
  createProfileStyles,
} from '@/styles/profileStyles';
import { useBottomPadding } from '@/hooks/useScreenPadding';
import { t, useI18n } from '@/i18n';

type ProfileRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
};

type SavedProfile = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
};

function splitFullName(
  fullName: string
) {
  const parts =
    fullName
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  return {
    firstName:
      parts[0] ?? '',
    lastName:
      parts.slice(1).join(' '),
  };
}

function createInitials(
  firstName: string,
  lastName: string
) {
  const initials =
    `${firstName.charAt(0)}${lastName.charAt(0)}`
      .toUpperCase();

  return initials || 'AF';
}

function formatRole(
  role: string
) {
  if (
    !role
  ) {
    return 'Farmer';
  }

  return `${role.charAt(0).toUpperCase()}${role.slice(1).toLowerCase()}`;
}

export default function ProfileScreen() {
  // Re-renders in the farmer's language; t() below reads the same choice.
  useI18n();
  // The floating tab bar (if any), the bottom safe area and 16 below the last control.
  const bottomPad = useBottomPadding(true);
  const {
    user,
    updateProfile,
    signOut,
  } = useAuth();

  const {
    farm,
    isFarmLoading,
    farmError,
  } = useAgroFlow();

  const {
    colors,
  } = useTheme();

  const styles =
    useMemo(
      () =>
        createProfileStyles(
          colors
        ),
      [
        colors,
      ]
    );

  const [
    editing,
    setEditing,
  ] =
    useState(false);

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    firstName,
    setFirstName,
  ] =
    useState('');

  const [
    lastName,
    setLastName,
  ] =
    useState('');

  const [
    email,
    setEmail,
  ] =
    useState('');

  const [
    phone,
    setPhone,
  ] =
    useState('');

  const [
    savedProfile,
    setSavedProfile,
  ] =
    useState<
      SavedProfile | null
    >(null);

  const [
    profileLoading,
    setProfileLoading,
  ] =
    useState(true);

  const [
    profileError,
    setProfileError,
  ] =
    useState('');

// Load the signed-in user's profile from Supabase (the auth user ID is the profile ID).
// If the request fails we fall back to the auth metadata so the screen still works.
  useEffect(
    () => {
      if (
        !user
      ) {
        setProfileLoading(
          false
        );

        return;
      }

      const authUser =
        user!;

      let isMounted =
        true;

      async function loadProfile() {
        try {
          setProfileLoading(
            true
          );

          setProfileError('');

          const dashboard =
            await fetchFarmerDashboard();
          const data =
            dashboard.profile;

          if (!data) throw new Error('Profile not found.');

          if (
            !isMounted
          ) {
            return;
          }

          const profile =
            data as ProfileRecord;

          const names =
            splitFullName(
              profile.name
            );

          const loadedProfile: SavedProfile =
            {
              ...names,
              email:
                profile.email,
              phone:
                profile.phone ?? '',
              role:
                profile.role,
            };

          setFirstName(
            loadedProfile.firstName
          );

          setLastName(
            loadedProfile.lastName
          );

          setEmail(
            loadedProfile.email
          );

          setPhone(
            loadedProfile.phone
          );

          setSavedProfile(
            loadedProfile
          );
        } catch (
          error: unknown
        ) {
          if (
            !isMounted
          ) {
            return;
          }

          console.log(
            'Profile load error:',
            error
          );

          const fallbackProfile: SavedProfile =
            {
              firstName:
                authUser.firstName,
              lastName:
                authUser.lastName,
              email:
                authUser.email,
              phone:
                authUser.phone,
              role:
                authUser.role,
            };

          setFirstName(
            fallbackProfile.firstName
          );

          setLastName(
            fallbackProfile.lastName
          );

          setEmail(
            fallbackProfile.email
          );

          setPhone(
            fallbackProfile.phone
          );

          setSavedProfile(
            fallbackProfile
          );

          setProfileError(
            t('profile.loadFailed')
          );
        } finally {
          if (
            isMounted
          ) {
            setProfileLoading(
              false
            );
          }
        }
      }

      void loadProfile();

      return () => {
        isMounted =
          false;
      };
    },
    [
      user,
    ]
  );

  if (
    !user
  ) {
    return null;
  }

  const currentUser =
    user;

  const displayedFirstName =
    savedProfile?.firstName ??
    currentUser.firstName;

  const displayedLastName =
    savedProfile?.lastName ??
    currentUser.lastName;

  const displayedEmail =
    savedProfile?.email ??
    currentUser.email;

  const displayedPhone =
    savedProfile?.phone ??
    currentUser.phone;

  const displayedRole =
    formatRole(
      savedProfile?.role ??
        currentUser.role
    );

  const displayedName =
    [
      displayedFirstName,
      displayedLastName,
    ]
      .filter(Boolean)
      .join(' ');

  const displayedInitials =
    createInitials(
      displayedFirstName,
      displayedLastName
    );

  function resetForm() {
    setFirstName(
      displayedFirstName
    );

    setLastName(
      displayedLastName
    );

    setEmail(
      displayedEmail
    );

    setPhone(
      displayedPhone
    );
  }

  function handleCancel() {
    resetForm();

    setEditing(
      false
    );
  }

  async function handleSave() {
    const cleanFirstName =
      firstName.trim();

    const cleanLastName =
      lastName.trim();

    const cleanEmail =
      displayedEmail;

    const cleanPhone =
      phone.trim();

    if (
      !cleanFirstName
    ) {
      Alert.alert(
        t('profile.nameRequired'),
        t('profile.enterFirstName')
      );

      return;
    }

    const fullName =
      [
        cleanFirstName,
        cleanLastName,
      ]
        .filter(Boolean)
        .join(' ');

    try {
      setSaving(
        true
      );
// Save the editable fields. Security: email and role are left out, so this screen cannot
// change them. Then refresh the auth metadata so the new name, phone and initials show everywhere.
      await updateProfileThroughApi(
        fullName,
        cleanPhone
      );

      await updateProfile({
        firstName:
          cleanFirstName,

        lastName:
          cleanLastName,

        email:
          cleanEmail,

        phone:
          cleanPhone,
      });

      setSavedProfile({
        firstName:
          cleanFirstName,
        lastName:
          cleanLastName,
        email:
          cleanEmail,
        phone:
          cleanPhone,
        role:
          savedProfile?.role ??
          currentUser.role,
      });

      setProfileError('');

      setEditing(
        false
      );

      Alert.alert(
        t('profile.updated'),
        t('profile.updatedBody')
      );
    } catch (
      error: unknown
    ) {
      console.log(
        'Profile update error:',
        error
      );

      Alert.alert(
        t('profile.updateFailed'),
        t('profile.updateFailedBody')
      );
    } finally {
      setSaving(
        false
      );
    }
  }
// Ask the user to confirm, then sign out, which clears the auth state and the stored session.
  function handleLogout() {
    Alert.alert(
      t('profile.logOutTitle'),
      t('profile.logOutBody'),
      [
        {
          text:
            t('common.cancel'),
          style:
            'cancel',
        },
        {
          text:
            t('profile.logOut'),
          style:
            'destructive',
          onPress:
            async () => {
              await signOut();
            },
        },
      ]
    );
  }

  return (
    <SafeAreaView
      style={
        styles.container
      }
      edges={[
        'top',
      ]}
    >
      <ScrollView
        style={
          styles.page
        }
        showsVerticalScrollIndicator={
          false
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
      >
        <View
          style={
            styles.topBar
          }
        >
          <TouchableOpacity
            style={
              styles.backButton
            }
            onPress={() =>
              router.canGoBack() ? router.back() : router.navigate('/')
            }
            activeOpacity={
              0.7
            }
          >
            <Text
              style={
                styles.backArrow
              }
            >
              ‹
            </Text>

            <Text
              style={
                styles.backText
              }
            >
              {t('common.back')}
            </Text>
          </TouchableOpacity>

          <HelpButton screen="profile" />

          {!editing ? (
            <TouchableOpacity
              style={[
                styles.editButton,

                profileLoading &&
                  styles.disabledButton,
              ]}
              onPress={() =>
                setEditing(
                  true
                )
              }
              activeOpacity={
                0.75
              }
              disabled={
                profileLoading
              }
            >
              <Text
                style={
                  styles.editButtonText
                }
              >
                {t('profile.edit')}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={
                styles.cancelTopButton
              }
              onPress={
                handleCancel
              }
              activeOpacity={
                0.75
              }
            >
              <Text
                style={
                  styles.cancelTopText
                }
              >
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {profileError ? (
          <View
            style={
              styles.profileErrorBox
            }
          >
            <Text
              style={
                styles.profileErrorText
              }
            >
              {
                profileError
              }
            </Text>
          </View>
        ) : null}

        <View
          style={
            styles.header
          }
        >
          <View
            style={
              styles.initialsBox
            }
          >
            <Text
              style={
                styles.initials
              }
            >
              {
                displayedInitials
              }
            </Text>
          </View>

          <View
            style={
              styles.headerText
            }
          >
            <Text
              style={
                styles.name
              }
            >
              {
                displayedName
              }
            </Text>

            <Text
              style={
                styles.role
              }
            >
              {
                displayedRole
              }
            </Text>
          </View>
        </View>

        {editing ? (
          <>
            <Text
              style={
                styles.sectionTitle
              }
            >
              {t('profile.personal')}
            </Text>

            <View
              style={
                styles.formCard
              }
            >
              <View
                style={
                  styles.inputGroup
                }
              >
                <Text
                  style={
                    styles.inputLabel
                  }
                >
                  {t('profile.firstName')}
                </Text>

                <TextInput
                  value={
                    firstName
                  }
                  onChangeText={
                    setFirstName
                  }
                  style={
                    styles.input
                  }
                  placeholder={t('profile.firstName')}
                  placeholderTextColor={
                    colors.textMuted
                  }
                  autoCapitalize="words"
                />
              </View>

              <View
                style={
                  styles.inputGroup
                }
              >
                <Text
                  style={
                    styles.inputLabel
                  }
                >
                  {t('profile.lastName')}
                </Text>

                <TextInput
                  value={
                    lastName
                  }
                  onChangeText={
                    setLastName
                  }
                  style={
                    styles.input
                  }
                  placeholder={t('profile.lastName')}
                  placeholderTextColor={
                    colors.textMuted
                  }
                  autoCapitalize="words"
                />
              </View>

              <View
                style={
                  styles.inputGroup
                }
              >
                <Text
                  style={
                    styles.inputLabel
                  }
                >
                  {t('profile.emailReadOnly')}
                </Text>

                <TextInput
                  value={
                    email
                  }
                  style={[
                    styles.input,
                    styles.readOnlyInput,
                  ]}
                  placeholder={t('signin.email')}
                  placeholderTextColor={
                    colors.textMuted
                  }
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={
                    false
                  }
                  editable={
                    false
                  }
                  selectTextOnFocus={
                    false
                  }
                />
              </View>

              <View
                style={[
                  styles.inputGroup,
                  styles.lastInputGroup,
                ]}
              >
                <Text
                  style={
                    styles.inputLabel
                  }
                >
                  {t('profile.phone')}
                </Text>

                <TextInput
                  value={
                    phone
                  }
                  onChangeText={
                    setPhone
                  }
                  style={
                    styles.input
                  }
                  placeholder={t('profile.phoneNumber')}
                  placeholderTextColor={
                    colors.textMuted
                  }
                  keyboardType="phone-pad"
                />
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.saveButton,

                saving &&
                  styles.disabledButton,
              ]}
              onPress={
                handleSave
              }
              activeOpacity={
                0.75
              }
              disabled={
                saving
              }
            >
              <Text
                style={
                  styles.saveButtonText
                }
              >
                {saving
                  ? t('common.saving')
                  : t('profile.save')}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text
              style={
                styles.sectionTitle
              }
            >
              {t('profile.account')}
            </Text>

            <View
              style={
                styles.sectionCard
              }
            >
              <ProfileRow
                label={t('profile.firstName')}
                value={
                  displayedFirstName || t('profile.notAdded')
                }
              />

              <ProfileRow
                label={t('profile.lastName')}
                value={
                  displayedLastName ||
                  t('profile.notAdded')
                }
              />

              <ProfileRow
                label={t('profile.email')}
                value={
                  displayedEmail
                }
              />

              <ProfileRow
                label={t('profile.phone')}
                value={
                  displayedPhone ||
                  t('profile.notAdded')
                }
                last
              />
            </View>
          </>
        )}

        <Text
          style={
            styles.sectionTitle
          }
        >
          {t('profile.farm')}
        </Text>

        <View
          style={
            styles.sectionCard
          }
        >
          <FarmSelector />

          <ProfileRow
            label={t('profile.location')}
            value={
              isFarmLoading
                ? t('profile.loading')
                : farm?.location ??
                  farmError ??
                  t('profile.notAvailable')
            }
            last
          />
        </View>

        {!editing && (
          <TelegramSection />
        )}

        {!editing && (
          <>
            <TouchableOpacity
              style={
                styles.changePasswordButton
              }
              onPress={() =>
                router.push({
                  pathname:
                    '/update-password',
                  params: {
                    source:
                      'profile',
                  },
                })
              }
              activeOpacity={
                0.75
              }
            >
              <Text
                style={
                  styles.changePasswordText
                }
              >
                {t('profile.changePassword')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={
                styles.logoutButton
              }
              onPress={
                handleLogout
              }
              activeOpacity={
                0.75
              }
            >
              <Text
                style={
                  styles.logoutText
                }
              >
                {t('profile.logOut')}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  const {
    colors,
  } = useTheme();

  const styles =
    useMemo(
      () =>
        createProfileStyles(
          colors
        ),
      [
        colors,
      ]
    );

  return (
    <View
      style={[
        styles.infoRow,

        last &&
          styles.lastInfoRow,
      ]}
    >
      <Text
        style={
          styles.infoLabel
        }
      >
        {
          label
        }
      </Text>

      <Text
        style={
          styles.infoValue
        }
      >
        {
          value
        }
      </Text>
    </View>
  );
}

