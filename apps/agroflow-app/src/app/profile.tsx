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
  useTheme,
} from '@/context/ThemeContext';

import {
  mockFarm,
} from '@/data/mockFarm';

export default function ProfileScreen() {
  const {
    user,
    updateProfile,
    signOut,
  } = useAuth();

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
//load user profile data into the form fields when the component mounts or when the user object changes. The useEffect hook checks if the user object is available, and if so, it sets the state variables for first name, last name, email, and phone with the corresponding values from the user object. This ensures that the form fields are pre-populated with the user's current profile information.
  useEffect(
    () => {
      if (
        !user
      ) {
        return;
      }

      setFirstName(
        user.firstName
      );

      setLastName(
        user.lastName
      );

      setEmail(
        user.email
      );

      setPhone(
        user.phone
      );
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

  function resetForm() {
    setFirstName(
      currentUser.firstName
    );

    setLastName(
      currentUser.lastName
    );

    setEmail(
      currentUser.email
    );

    setPhone(
      currentUser.phone
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
      email
        .trim()
        .toLowerCase();

    const cleanPhone =
      phone.trim();

    if (
      !cleanFirstName ||
      !cleanLastName
    ) {
      Alert.alert(
        'Name Required',
        'Enter both your first name and last name.'
      );

      return;
    }

    if (
      !cleanEmail
    ) {
      Alert.alert(
        'Email Required',
        'Enter your email address.'
      );

      return;
    }
//validating the email format using a regular expression. The regex checks if the cleaned email input matches the standard email format. If the email is not valid, an alert is displayed to inform the user to enter a valid email address.
    const emailIsValid =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        cleanEmail
      );

    if (
      !emailIsValid
    ) {
      Alert.alert(
        'Invalid Email',
        'Enter a valid email address.'
      );

      return;
    }

    try {
      setSaving(
        true
      );
//updating the user's profile by calling the updateProfile function from the AuthContext with the cleaned input values. If the update is successful, a success alert is shown. If an error occurs during the update, an error alert is displayed to inform the user.
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
              style={
                styles.editButton
              }
              onPress={() =>
                setEditing(
                  true
                )
              }
              activeOpacity={
                0.75
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
                currentUser.initials
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
                currentUser.firstName
              }{' '}
              {
                currentUser.lastName
              }
            </Text>

            <Text
              style={
                styles.role
              }
            >
              {
                currentUser.role
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
                  Email
                </Text>

                <TextInput
                  value={
                    email
                  }
                  onChangeText={
                    setEmail
                  }
                  style={
                    styles.input
                  }
                  placeholder="Email address"
                  placeholderTextColor={
                    colors.textMuted
                  }
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={
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
                  currentUser.firstName
                }
              />

              <ProfileRow
                label="Last Name"
                value={
                  currentUser.lastName
                }
              />

              <ProfileRow
                label="Email"
                value={
                  currentUser.email
                }
              />

              <ProfileRow
                label="Phone"
                value={
                  currentUser.phone ||
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
              mockFarm.name
            }
          />

          <ProfileRow
            label="Location"
            value={
              mockFarm.location.city
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