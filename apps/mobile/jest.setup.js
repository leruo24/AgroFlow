// AsyncStorage's native module does not exist under Jest. Its own in-memory mock, for every
// suite (https://react-native-async-storage.github.io/async-storage/docs/advanced/jest), now
// that the API client keeps an offline copy and queue through it.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
