//profile screen
import {
  router,
} from 'expo-router';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  SafeAreaView,
} from 'react-native-safe-area-context';

import type {
  AppColors,
} from '@/constants/colors';

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
  supabase,
} from '@/lib/supabase';

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
        createStyles(
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

//load the signed-in user's public profile from Supabase. The auth user ID and profile ID are the same, so only the current user's row is requested. If the database request fails, the auth metadata is used as a safe fallback so that the screen remains usable.
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

          const {
            data,
            error,
          } =
            await supabase
              .from(
                'profile'
              )
              .select(
                'id, name, email, role, phone'
              )
              .eq(
                'id',
                authUser.id
              )
              .single();

          if (
            error
          ) {
            throw error;
          }

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
            'Could not load the latest profile information.'
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
        'Name Required',
        'Enter your first name.'
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
//save the editable fields to the public profile row. Email and role are deliberately excluded, so this screen cannot change either protected field. Auth metadata is then refreshed so the rest of the app immediately shows the new name, phone, and initials.
      const {
        error: databaseError,
      } =
        await supabase
          .from(
            'profile'
          )
          .update({
            name:
              fullName,
            phone:
              cleanPhone,
          })
          .eq(
            'id',
            currentUser.id
          )
          .select(
            'id'
          )
          .single();

      if (
        databaseError
      ) {
        throw databaseError;
      }

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
        'Profile Updated',
        'Your profile details have been saved.'
      );
    } catch (
      error: unknown
    ) {
      console.log(
        'Profile update error:',
        error
      );

      Alert.alert(
        'Update Failed',
        'Your profile could not be updated.'
      );
    } finally {
      setSaving(
        false
      );
    }
  }
//updates authentication state and clears stored session data when the user chooses to log out. The handleLogout function displays a confirmation alert asking the user if they want to log out. If the user confirms, the signOut function from the AuthContext is called, which clears the authentication state and any stored session data, effectively logging the user out of the application.
  function handleLogout() {
    Alert.alert(
      'Log Out?',
      'You will need to sign in again to access AgroFlow.',
      [
        {
          text:
            'Cancel',
          style:
            'cancel',
        },
        {
          text:
            'Log Out',
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
        showsVerticalScrollIndicator={
          false
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={
          styles.scrollContent
        }
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
              router.back()
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
              Back
            </Text>
          </TouchableOpacity>

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
                Edit Profile
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
                Cancel
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
              Personal Details
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
                  First Name
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
                  placeholder="First name"
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
                  Last Name
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
                  placeholder="Last name"
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
                  Email (read only)
                </Text>

                <TextInput
                  value={
                    email
                  }
                  style={[
                    styles.input,
                    styles.readOnlyInput,
                  ]}
                  placeholder="Email address"
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
                  Phone
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
                  placeholder="Phone number"
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
                  ? 'Saving...'
                  : 'Save Changes'}
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
              Account Information
            </Text>

            <View
              style={
                styles.sectionCard
              }
            >
              <ProfileRow
                label="First Name"
                value={
                  displayedFirstName
                }
              />

              <ProfileRow
                label="Last Name"
                value={
                  displayedLastName ||
                  'Not added'
                }
              />

              <ProfileRow
                label="Email"
                value={
                  displayedEmail
                }
              />

              <ProfileRow
                label="Phone"
                value={
                  displayedPhone ||
                  'Not added'
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
          Farm
        </Text>

        <View
          style={
            styles.sectionCard
          }
        >
          <ProfileRow
            label="Farm"
            value={
              isFarmLoading
                ? 'Loading...'
                : farm?.name ??
                  'Farm unavailable'
            }
          />

          <ProfileRow
            label="Location"
            value={
              isFarmLoading
                ? 'Loading...'
                : farm?.location ??
                  farmError ??
                  'Not available'
            }
            last
          />
        </View>

        {!editing && (
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
              Log Out
            </Text>
          </TouchableOpacity>
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
        createStyles(
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

function createStyles(
  colors: AppColors
) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        colors.background,
    },

    scrollContent: {
      paddingHorizontal: 18,
      paddingTop: 8,
      paddingBottom: 40,
    },

    topBar: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },

    profileErrorBox: {
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor:
        colors.errorBackground,
      borderWidth: 1,
      borderColor:
        colors.error,
    },

    profileErrorText: {
      fontSize: 10,
      lineHeight: 15,
      color:
        colors.error,
    },

    backButton: {
      flexDirection: 'row',
      alignItems: 'center',
    },

    backArrow: {
      marginRight: 5,
      fontSize: 28,
      lineHeight: 30,
      color:
        colors.text,
    },

    backText: {
      fontSize: 12,
      fontWeight: '600',
      color:
        colors.text,
    },

    editButton: {
      height: 36,
      paddingHorizontal: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.primary,
      borderWidth: 1,
      borderColor:
        colors.primaryDark,
    },

    editButtonText: {
      fontSize: 10,
      fontWeight: '700',
      color:
        colors.white,
    },

    cancelTopButton: {
      height: 36,
      paddingHorizontal: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    cancelTopText: {
      fontSize: 10,
      fontWeight: '600',
      color:
        colors.textSecondary,
    },

    header: {
      marginTop: 16,
      marginBottom: 24,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    initialsBox: {
      width: 52,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.lightBlue,
      borderWidth: 1,
      borderColor:
        colors.weatherBorder,
    },

    initials: {
      fontSize: 17,
      fontWeight: '700',
      color:
        colors.primaryDark,
    },

    headerText: {
      flex: 1,
      marginLeft: 13,
    },

    name: {
      fontSize: 20,
      fontWeight: '700',
      color:
        colors.text,
    },

    role: {
      marginTop: 4,
      fontSize: 11,
      color:
        colors.textSecondary,
    },

    sectionTitle: {
      marginTop: 6,
      marginBottom: 10,
      fontSize: 16,
      fontWeight: '700',
      color:
        colors.text,
    },

    sectionCard: {
      marginBottom: 22,
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    infoRow: {
      minHeight: 50,
      paddingHorizontal: 13,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 15,
      borderBottomWidth: 1,
      borderBottomColor:
        colors.border,
    },

    lastInfoRow: {
      borderBottomWidth: 0,
    },

    infoLabel: {
      flex: 1,
      fontSize: 10,
      color:
        colors.textSecondary,
    },

    infoValue: {
      flex: 1.5,
      fontSize: 11,
      fontWeight: '600',
      textAlign: 'right',
      color:
        colors.text,
    },

    formCard: {
      padding: 14,
      marginBottom: 10,
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    inputGroup: {
      marginBottom: 15,
    },

    lastInputGroup: {
      marginBottom: 0,
    },

    inputLabel: {
      marginBottom: 6,
      fontSize: 10,
      fontWeight: '600',
      color:
        colors.text,
    },

    input: {
      height: 44,
      paddingHorizontal: 12,
      backgroundColor:
        colors.background,
      borderWidth: 1,
      borderColor:
        colors.border,
      fontSize: 12,
      color:
        colors.text,
    },

    readOnlyInput: {
      opacity: 0.65,
      color:
        colors.textSecondary,
    },

    saveButton: {
      height: 44,
      marginBottom: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.primary,
      borderWidth: 1,
      borderColor:
        colors.primaryDark,
    },

    saveButtonText: {
      fontSize: 12,
      fontWeight: '700',
      color:
        colors.white,
    },

    disabledButton: {
      opacity: 0.55,
    },

    logoutButton: {
      height: 44,
      marginTop: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.errorBackground,
      borderWidth: 1,
      borderColor:
        colors.error,
    },

    logoutText: {
      fontSize: 12,
      fontWeight: '700',
      color:
        colors.error,
    },
  });
}