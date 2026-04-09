import { StyleSheet, View, Text, Pressable, Alert } from 'react-native';
import { useAuthStore } from '../../src/stores/authStore';

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{user?.display_name ?? 'User'}</Text>
      <Text style={styles.email}>{user?.email ?? ''}</Text>

      <Pressable
        style={({ pressed }) => [styles.logoutButton, pressed && { opacity: 0.7 }]}
        onPress={handleLogout}
      >
        <Text style={styles.logoutText}>Log Out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  email: {
    fontSize: 14,
    color: '#b3b3b3',
    marginTop: 4,
  },
  logoutButton: {
    marginTop: 40,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#e74c3c',
  },
  logoutText: {
    color: '#e74c3c',
    fontSize: 16,
    fontWeight: '600',
  },
});
