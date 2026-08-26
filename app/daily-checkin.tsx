/**
 * Legacy route → the Daily Check-in tab.
 *
 * The check-in used to be a standalone screen; it now lives in a tab so it has
 * a permanent home. This redirect exists so that Home's "Update today's
 * check-in" button — and any deep link already in the wild — keeps working
 * without Home itself being edited. Home is approved as-is and stays untouched.
 */

import { Redirect } from 'expo-router';

export default function DailyCheckinRedirect() {
  return <Redirect href="/(tabs)/checkin" />;
}
