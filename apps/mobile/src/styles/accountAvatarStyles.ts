import { StyleSheet } from 'react-native';
import { Radius, Type, type AppColors } from '@/constants/colors';

export function createAccountAvatarStyles(colors: AppColors) {
  return StyleSheet.create({
    avatar: { width: 48, height: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.white },
    initials: { color: colors.white, fontWeight: '700', fontSize: Type.body },
  });
}
