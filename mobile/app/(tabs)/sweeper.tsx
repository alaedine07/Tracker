import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  SectionList,
} from "react-native";
import { Image } from "expo-image";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  runSweeperScan,
  cleanTracks,
  UnavailableTrack,
  DuplicateGroup,
} from "../../src/api/sweeper";

// ──── Track Row ────

function UnavailableRow({
  track,
  isSelected,
  onToggle,
}: {
  track: UnavailableTrack;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable style={styles.trackRow} onPress={onToggle}>
      <View
        style={[styles.checkbox, isSelected && styles.checkboxSelected]}
      >
        {isSelected && <FontAwesome name="check" size={12} color="#fff" />}
      </View>
      <View style={styles.trackInfo}>
        <Text style={styles.trackName} numberOfLines={1}>
          {track.name}
        </Text>
        <Text style={styles.trackArtist} numberOfLines={1}>
          {track.artistNames?.join(", ") ?? "Unknown"}
        </Text>
        <Text style={styles.reasonText}>{track.reason}</Text>
      </View>
    </Pressable>
  );
}

function DuplicateRow({
  group,
  selectedIds,
  onToggle,
}: {
  group: DuplicateGroup;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <View style={styles.dupeGroup}>
      <Text style={styles.dupeName}>
        {group.name} — {group.artistNames?.join(", ")}
      </Text>
      {group.tracks.map((t) => (
        <Pressable
          key={t.trackId}
          style={styles.dupeTrackRow}
          onPress={() => onToggle(t.trackId)}
        >
          <View
            style={[
              styles.checkbox,
              selectedIds.has(t.trackId) && styles.checkboxSelected,
            ]}
          >
            {selectedIds.has(t.trackId) && (
              <FontAwesome name="check" size={12} color="#fff" />
            )}
          </View>
          <View style={styles.trackInfo}>
            <Text style={styles.trackName} numberOfLines={1}>
              {t.name}
            </Text>
            <Text style={styles.trackArtist}>
              {t.albumName ?? "Unknown Album"} · Found in:{" "}
              {t.foundIn.join(", ")}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// ──── Main Screen ────

export default function SweeperScreen() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"unavailable" | "duplicates">("unavailable");

  // ──── Queries ────
  const scanMutation = useMutation({
    mutationFn: runSweeperScan,
  });

  const cleanMutation = useMutation({
    mutationFn: (trackIds: string[]) => cleanTracks(trackIds),
    onSuccess: (data) => {
      Alert.alert("Cleaned", `${data.removed} tracks removed from your library.`);
      setSelectedIds(new Set());
      scanMutation.reset();
    },
    onError: (err: any) => {
      Alert.alert("Error", err?.response?.data?.error || "Failed to clean tracks");
    },
  });

  // ──── Handlers ────
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleClean = () => {
    if (selectedIds.size === 0) return;
    Alert.alert(
      "Clean Up",
      `Remove ${selectedIds.size} track(s) from your Spotify library?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => cleanMutation.mutate([...selectedIds]),
        },
      ]
    );
  };

  const results = scanMutation.data;
  const hasResults = !!results;

  return (
    <View style={styles.container}>
      {/* Scan Button */}
      {!hasResults && (
        <View style={styles.centerContent}>
          <FontAwesome name="magic" size={48} color="#333" />
          <Text style={styles.emptyTitle}>Library Sweeper</Text>
          <Text style={styles.emptySubtext}>
            Find unavailable tracks and duplicates in your library
          </Text>
          <Pressable
            style={[
              styles.scanButton,
              scanMutation.isPending && styles.scanButtonDisabled,
            ]}
            onPress={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
          >
            {scanMutation.isPending ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.scanButtonText}>Scan Library</Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Results */}
      {hasResults && (
        <>
          {/* Tab Switcher */}
          <View style={styles.tabRow}>
            <Pressable
              style={[styles.tabButton, tab === "unavailable" && styles.tabActive]}
              onPress={() => setTab("unavailable")}
            >
              <Text
                style={[
                  styles.tabText,
                  tab === "unavailable" && styles.tabTextActive,
                ]}
              >
                Unavailable ({results.unavailable.count})
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tabButton, tab === "duplicates" && styles.tabActive]}
              onPress={() => setTab("duplicates")}
            >
              <Text
                style={[
                  styles.tabText,
                  tab === "duplicates" && styles.tabTextActive,
                ]}
              >
                Duplicates ({results.duplicates.count})
              </Text>
            </Pressable>
          </View>

          {/* Unavailable Tracks */}
          {tab === "unavailable" && (
            <>
              {results.unavailable.tracks.length > 0 ? (
                <FlatList
                  data={results.unavailable.tracks}
                  renderItem={({ item }) => (
                    <UnavailableRow
                      track={item}
                      isSelected={selectedIds.has(item.trackId)}
                      onToggle={() => toggleSelect(item.trackId)}
                    />
                  )}
                  keyExtractor={(item) => item.trackId}
                  contentContainerStyle={styles.listContent}
                />
              ) : (
                <View style={styles.centerContent}>
                  <FontAwesome name="check-circle" size={40} color="#1DB954" />
                  <Text style={styles.successText}>
                    All tracks are available!
                  </Text>
                </View>
              )}
            </>
          )}

          {/* Duplicates */}
          {tab === "duplicates" && (
            <>
              {results.duplicates.groups.length > 0 ? (
                <FlatList
                  data={results.duplicates.groups}
                  renderItem={({ item }) => (
                    <DuplicateRow
                      group={item}
                      selectedIds={selectedIds}
                      onToggle={toggleSelect}
                    />
                  )}
                  keyExtractor={(item, i) => `${item.isrc ?? i}`}
                  contentContainerStyle={styles.listContent}
                />
              ) : (
                <View style={styles.centerContent}>
                  <FontAwesome name="check-circle" size={40} color="#1DB954" />
                  <Text style={styles.successText}>No duplicates found!</Text>
                </View>
              )}
            </>
          )}

          {/* Clean Button */}
          {selectedIds.size > 0 && (
            <View style={styles.cleanBar}>
              <Text style={styles.cleanBarText}>
                {selectedIds.size} track(s) selected
              </Text>
              <Pressable
                style={styles.cleanButton}
                onPress={handleClean}
                disabled={cleanMutation.isPending}
              >
                {cleanMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.cleanButtonText}>Clean Up</Text>
                )}
              </Pressable>
            </View>
          )}

          {/* Re-scan */}
          <Pressable
            style={styles.rescanButton}
            onPress={() => {
              setSelectedIds(new Set());
              scanMutation.mutate();
            }}
            disabled={scanMutation.isPending}
          >
            <FontAwesome name="refresh" size={14} color="#b3b3b3" />
            <Text style={styles.rescanText}>Re-scan</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

// ──── Styles ────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
  },
  centerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
    marginTop: 16,
  },
  emptySubtext: {
    color: "#b3b3b3",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  successText: {
    color: "#1DB954",
    fontSize: 16,
    fontWeight: "600",
    marginTop: 12,
  },
  listContent: {
    padding: 12,
  },

  // Scan button
  scanButton: {
    backgroundColor: "#1DB954",
    borderRadius: 25,
    paddingHorizontal: 32,
    paddingVertical: 14,
    marginTop: 24,
  },
  scanButtonDisabled: {
    opacity: 0.5,
  },
  scanButtonText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "bold",
  },

  // Tabs
  tabRow: {
    flexDirection: "row",
    padding: 12,
    gap: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#282828",
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: "#1DB954",
  },
  tabText: {
    color: "#b3b3b3",
    fontSize: 14,
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#000",
  },

  // Tracks
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#555",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  checkboxSelected: {
    backgroundColor: "#e74c3c",
    borderColor: "#e74c3c",
  },
  trackInfo: {
    flex: 1,
  },
  trackName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },
  trackArtist: {
    color: "#b3b3b3",
    fontSize: 12,
    marginTop: 2,
  },
  reasonText: {
    color: "#e74c3c",
    fontSize: 11,
    marginTop: 2,
  },

  // Duplicates
  dupeGroup: {
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  dupeName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  dupeTrackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },

  // Clean bar
  cleanBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a1a",
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: "#282828",
  },
  cleanBarText: {
    color: "#fff",
    fontSize: 14,
  },
  cleanButton: {
    backgroundColor: "#e74c3c",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  cleanButtonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },

  // Re-scan
  rescanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    gap: 6,
  },
  rescanText: {
    color: "#b3b3b3",
    fontSize: 13,
  },
});
