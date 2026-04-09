import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={24} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#1DB954',
        tabBarInactiveTintColor: '#b3b3b3',
        tabBarStyle: {
          backgroundColor: '#121212',
          borderTopColor: '#282828',
        },
        headerStyle: { backgroundColor: '#121212' },
        headerTintColor: '#fff',
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Library',
          tabBarIcon: ({ color }) => <TabBarIcon name="music" color={color} />,
        }}
      />
      <Tabs.Screen
        name="staging"
        options={{
          title: 'Staging',
          tabBarIcon: ({ color }) => <TabBarIcon name="inbox" color={color} />,
        }}
      />
      <Tabs.Screen
        name="sweeper"
        options={{
          title: 'Sweeper',
          tabBarIcon: ({ color }) => <TabBarIcon name="magic" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <TabBarIcon name="user" color={color} />,
        }}
      />
    </Tabs>
  );
}
