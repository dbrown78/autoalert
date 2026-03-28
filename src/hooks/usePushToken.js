import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import client from '../api/client';

/**
 * Registers the device's Expo push token with the backend.
 * Call after a successful login with the JWT token in place.
 */
export async function registerPushToken(jwtToken) {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.warn('[PushToken] Notification permission not granted');
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    await client.put(
      '/push/token',
      { token: expoPushToken },
      { headers: { Authorization: `Bearer ${jwtToken}` } },
    );
  } catch (e) {
    console.warn('[PushToken] registration failed:', e);
  }
}
