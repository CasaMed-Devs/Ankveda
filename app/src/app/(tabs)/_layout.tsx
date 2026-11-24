import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { TabBar } from '@/components/TabBar';
import { useMe } from '@/lib/queries';
import { colors } from '@/theme/tokens';

/** The five main tabs — the only screens that show the bottom navigation (as in Figma 17–21). */
export default function TabsLayout() {
  const me = useMe();

  // Name + date of birth drive every screen; never show the app without them.
  if (me.data && (!me.data.fullName || !me.data.dob)) return <Redirect href="/about-you" />;

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.backgroundTop } }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="chat" />
      <Tabs.Screen name="reports" />
      <Tabs.Screen name="daily" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
