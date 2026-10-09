import { Alert, Platform, type AlertButton, type AlertOptions } from 'react-native';

// React Native's Alert does nothing on web, so we show the same confirmations there ourselves.
export const AppAlert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
    if (Platform.OS !== 'web') return Alert.alert(title, message, buttons, options);
    const text = [title, message].filter(Boolean).join('\n\n');
    const action = buttons?.find(button => button.style !== 'cancel');
    if (buttons?.some(button => button.style === 'cancel')) {
      if (window.confirm(text)) action?.onPress?.();
      else buttons.find(button => button.style === 'cancel')?.onPress?.();
    } else {
      window.alert(text);
      action?.onPress?.();
    }
  },
};
