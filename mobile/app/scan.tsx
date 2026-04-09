import React, { useEffect, useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { triggerScan, getScanStatus, ScanStatus } from "../src/api/library";

export default function ScanScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<ScanStatus>({ status: "none" });
  const [error, setError] = useState<string | null>(null);

  const startScan = useCallback(async () => {
    try {
      await triggerScan();
    } catch (err: any) {
      // 409 = already running, which is fine
      if (err.response?.status !== 409) {
        setError(err.message || "Failed to start scan");
      }
    }
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const s = await getScanStatus();
      setStatus(s);

      if (s.status === "completed") {
        router.replace("/(tabs)");
      } else if (s.status === "failed") {
        setError(s.errorMessage || "Scan failed");
      }
    } catch {
      // Silently retry on poll failure
    }
  }, [router]);

  useEffect(() => {
    startScan();
  }, [startScan]);

  useEffect(() => {
    if (status.status === "completed" || status.status === "failed") return;

    const interval = setInterval(pollStatus, 2000);
    pollStatus(); // Initial poll
    return () => clearInterval(interval);
  }, [pollStatus, status.status]);

  const progress =
    status.totalTracks && status.totalTracks > 0
      ? Math.round(((status.processedTracks ?? 0) / status.totalTracks) * 100)
      : 0;

  const phaseLabel =
    status.currentPhase === "liked-songs"
      ? "Scanning liked songs..."
      : status.currentPhase === "playlists"
        ? "Scanning playlists..."
        : "Preparing...";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Syncing Your Library</Text>
      <Text style={styles.subtitle}>{phaseLabel}</Text>

      <View style={styles.progressContainer}>
        <View style={styles.progressBackground}>
          <View
            style={[styles.progressBar, { width: `${Math.min(progress, 100)}%` }]}
          />
        </View>
        <Text style={styles.progressText}>
          {status.processedTracks ?? 0} / {status.totalTracks ?? "?"} tracks
        </Text>
      </View>

      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <ActivityIndicator
          size="large"
          color="#1DB954"
          style={styles.spinner}
        />
      )}

      <Text style={styles.hint}>
        This may take a minute for large libraries
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#b3b3b3",
    marginBottom: 30,
  },
  progressContainer: {
    width: "100%",
    marginBottom: 30,
  },
  progressBackground: {
    height: 8,
    backgroundColor: "#282828",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#1DB954",
    borderRadius: 4,
  },
  progressText: {
    color: "#b3b3b3",
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
  },
  spinner: {
    marginBottom: 20,
  },
  errorText: {
    color: "#e74c3c",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 20,
  },
  hint: {
    color: "#666",
    fontSize: 12,
    textAlign: "center",
  },
});
