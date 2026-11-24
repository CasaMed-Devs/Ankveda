import { router } from 'expo-router';

/** Close any stacked report/paywall screens and land on the Home tab. */
export const goHome = () => router.dismissTo('/home');

/** Close any stacked screens and land on the Reports tab. */
export const goReports = () => router.dismissTo('/reports');
