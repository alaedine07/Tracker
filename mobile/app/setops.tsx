import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { getPlaylists, PlaylistSummary } from "../src/api/library";
import { performSetOperation, SetOperationResult } from "../src/api/sets";

type Operation = "union" | "intersection" | "difference";

const OP_LABELS: Record<Operation, { label: string; icon: string; desc: string }> = {
  union: { label: "Union", icon: "plus-circle", desc: "All tracks from both" },
  intersection: { label: "Intersection", icon: "bullseye", desc: "Tracks in both" },
  difference: { label: "Difference", icon: "minus-circle", desc: "In A but not B" },
};

function PlaylistSelectRow({
  playlist,
  isSelected,
  tag,
  onPress,
}: {
  playlist: PlaylistSummary;
  isSelected: boolean;
  tag: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.playlistRow, isSelected && styles.playlistRowSelected]}
      onPress={onPress}
    >
      {playlist.imageUrl ? (
        <Image source={{ uri: playlist.imageUrl }} style={styles.playlistArt} />
      ) : (
        <View style={[styles.playlistArt, styles.playlistArtPlaceholder]} />
      )}
      <View style={styles.playlistInfo}>
        <Text style={styles.playlistName} numberOfLines={1}>
          {playlist.name}
        </Text>
        <Text style={styles.playlistMeta}>{playlist.trackCount} tracks</Text>
      </View>
      {tag && (
        <View style={styles.tag}>
          <Text style={styles.tagText}>{tag}</Text>
        </View>
      )}
    </Pressable>
  );
}

export default function SetOpsScreen() {
  const router = useRouter();
  const [operation, setOperation] = useState<Operation>("intersection");
  const [sourceA, setSourceA] = useState<string | null>(null);
  const [sourceB, setSourceB] = useState<string | null>(null);
  const [result, setResult] = useState<SetOperationResult | null>(null);

  const playlistsQuery = useQuery({
    queryKey: ["library-playlists"],
    queryFn: getPlaylists,
  });

  const operationMutation = useMutation({
    mutationFn: () => {
      if (!sourceA || !sourceB) throw new Error("Select two playlists");
      return performSetOperation(operation, sourceA, sourceB, false);
    },
    onSuccess: setResult,
    onError: (err: any) => {
      Alert.alert("Error", err?.response?.data?.error || "Operation failed");
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!sourceA || !sourceB) throw new Error("Select two playlists");
      return performSetOperation(
        operation,
        sourceA,
        sourceB,
        true,
        `${OP_LABELS[operation].label} result`
      );
    },
    onSuccess: (data) => {
      Alert.alert("Saved!", `Bin created with ${data.trackCount} tracks.`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    },
    onError: (err: any) => {
      Alert.alert("Error", err?.response?.data?.error || "Failed to save bin");
    },
  });

  const handlePlaylistPress = (id: string) => {
    if (sourceA === id) {
      setSourceA(null);
    } else if (sourceB === id) {
      setSourceB(null);
    } else if (!sourceA) {
      setSourceA(id);
    } else if (!sourceB) {
      setSourceB(id);
    } else {
      // Both selected, replace B
      setSourceB(id);
    }
    setResult(null);
  };

  const getTag = (id: string) => {
    if (sourceA === id) return "A";
    if (sourceB === id) return "B";
    return null;
  };

  // Include "Liked Songs" as a source
  const sources = [
    { id: "liked", name: "Liked Songs", trackCount: 0, imageUrl: null } as any,
    ...(playlistsQuery.data?.items ?? []),
  ];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <FontAwesome name="arrow-left" size={18} color="#fff" />
        </Pressable>
        <Text style={styles.title}>Set Operations</Text>
      </View>

      {/* Operation Selector */}
      <View style={styles.opRow}>
        {(Object.keys(OP_LABELS) as Operation[]).map((op) => (
          <Pressable
            key={op}
            style={[styles.opButton, operation === op && styles.opButtonActive]}
            onPress={() => {
              setOperation(op);
              setResult(null);
            }}
          >
            <Text
              style={[styles.opText, operation === op && styles.opTextActive]}
            >
              {OP_LABELS[op].label}
            </Text>
            <Text style={styles.opDesc}>{OP_LABELS[op].desc}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.instruction}>
        Tap to select playlist A, then playlist B
      </Text>

      {/* Playlist List */}
      {playlistsQuery.isLoading ? (
        <ActivityIndicator color="#1DB954" style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={sources}
          renderItem={({ item }) => (
            <PlaylistSelectRow
              playlist={item}
              isSelected={sourceA === item.id || sourceB === item.id}
              tag={getTag(item.id)}
              onPress={() => handlePlaylistPress(item.id)}
            />
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          style={{ flex: 1 }}
        />
      )}

      {/* Execute Button */}
      {sourceA && sourceB && !result && (
        <Pressable
          style={[
            styles.executeButton,
            operationMutation.isPending && styles.executeButtonDisabled,
          ]}
          onPress={() => operationMutation.mutate()}
          disabled={operationMutation.isPending}
        >
          {operationMutation.isPending ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.executeText}>
              Preview {OP_LABELS[operation].label}
            </Text>
          )}
        </Pressable>
      )}

      {/* Result Preview */}
      {result && (
        <View style={styles.resultBar}>
          <Text style={styles.resultText}>
            {result.trackCount} tracks in result
          </Text>
          <Pressable
            style={styles.saveButton}
            onPress={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text style={styles.saveText}>Save as Bin</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    paddingTop: 50,
    gap: 14,
  },
  backBtn: {
    padding: 4,
  },
  title: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },

  // Operation selector
  opRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    gap: 8,
  },
  opButton: {
    flex: 1,
    backgroundColor: "#282828",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  opButtonActive: {
    backgroundColor: "#1DB954",
  },
  opText: {
    color: "#b3b3b3",
    fontSize: 14,
    fontWeight: "700",
  },
  opTextActive: {
    color: "#000",
  },
  opDesc: {
    color: "#888",
    fontSize: 10,
    marginTop: 2,
  },

  instruction: {
    color: "#666",
    fontSize: 13,
    textAlign: "center",
    marginVertical: 10,
  },

  listContent: {
    paddingHorizontal: 12,
  },

  // Playlist rows
  playlistRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 8,
    marginBottom: 4,
  },
  playlistRowSelected: {
    backgroundColor: "#1a2e1a",
  },
  playlistArt: {
    width: 44,
    height: 44,
    borderRadius: 4,
    marginRight: 12,
  },
  playlistArtPlaceholder: {
    backgroundColor: "#333",
  },
  playlistInfo: {
    flex: 1,
  },
  playlistName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },
  playlistMeta: {
    color: "#b3b3b3",
    fontSize: 12,
    marginTop: 2,
  },
  tag: {
    backgroundColor: "#1DB954",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: {
    color: "#000",
    fontWeight: "bold",
    fontSize: 13,
  },

  // Execute
  executeButton: {
    backgroundColor: "#1DB954",
    margin: 12,
    padding: 14,
    borderRadius: 25,
    alignItems: "center",
  },
  executeButtonDisabled: {
    opacity: 0.5,
  },
  executeText: {
    color: "#000",
    fontWeight: "bold",
    fontSize: 15,
  },

  // Result
  resultBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a1a",
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: "#282828",
  },
  resultText: {
    color: "#fff",
    fontSize: 14,
  },
  saveButton: {
    backgroundColor: "#1DB954",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  saveText: {
    color: "#000",
    fontWeight: "bold",
    fontSize: 14,
  },
});
