import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { FontAwesome } from "@expo/vector-icons";
import { useSpotifyAuth } from "../../src/hooks/useSpotifyAuth";

export default function LoginScreen() {
  const { login } = useSpotifyAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      await login();
    } catch (error: any) {
      Alert.alert(
        "Login Failed",
        error.message || "Something went wrong. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <FontAwesome name="music" size={64} color="#1DB954" />
        <Text style={styles.title}>Library Architect</Text>
        <Text style={styles.subtitle}>
          Organize your Spotify library with AI-powered playlists
        </Text>

        <Pressable
          style={({ pressed }) => [
            styles.loginButton,
            pressed && styles.loginButtonPressed,
          ]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <FontAwesome
                name="spotify"
                size={24}
                color="#fff"
                style={styles.spotifyIcon}
              />
              <Text style={styles.loginButtonText}>
                Connect with Spotify
              </Text>
            </>
          )}
        </Pressable>

        <Text style={styles.disclaimer}>
          Requires a Spotify Premium account
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    alignItems: "center",
    paddingHorizontal: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#fff",
    marginTop: 20,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#b3b3b3",
    marginTop: 12,
    textAlign: "center",
    lineHeight: 22,
  },
  loginButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1DB954",
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 50,
    marginTop: 40,
    minWidth: 260,
  },
  loginButtonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  spotifyIcon: {
    marginRight: 10,
  },
  loginButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  disclaimer: {
    fontSize: 12,
    color: "#666",
    marginTop: 20,
  },
});
