import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { useSubscribe } from '@/hooks/useSubscribe';
import { api, ApiError } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import type { Plan } from '@/lib/types';

/**
 * Subscribe to the featured plan, then — if a report is waiting — start generating it
 * and move to the processing screen.
 */
export const usePremiumCheckout = (reportId?: string) => {
  const { subscribe, busy } = useSubscribe();
  const [generating, setGenerating] = useState(false);

  const checkout = async (plan: Plan) => {
    const ok = await subscribe(plan);
    if (!ok) return;

    if (!reportId) {
      if (router.canGoBack()) router.back();
      else router.replace('/home');
      return;
    }

    setGenerating(true);
    try {
      const { report } = await api.generateReport(reportId);
      queryClient.setQueryData(keys.report(report.id), report);
      void queryClient.invalidateQueries({ queryKey: keys.reports, exact: true });
      router.replace(`/report/${reportId}/processing`);
    } catch (e) {
      Alert.alert('Your report', e instanceof ApiError ? e.message : 'We could not start your report. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  return { checkout, busy: busy || generating };
};
