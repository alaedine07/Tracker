import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { getLibraryTracks, getPlaylists, LibraryTrack } from "../../src/api/library";

function TrackRow({ track }: { track: LibraryTrack }) {
  const artists = track.artistNames?.join(", ") ?? "Unknown";
  const duration = track.durationMs
    ? `${Math.floor(track.durationMs / 60000)}:${String(
        Math.floor((track.durationMs % 60000) / 1000)
      ).padStart(2, "0")}`
    : "";

  return (
    <View style={styles.trackRow}>
      {track.albumArtUrl ? (
        <Image source={{ uri: track.albumArtUrl }} style={styles.albumArt} />
      ) : (
        <View style={[styles.albumArt, styles.albumArtPlaceholder]} />
      )}
      <View style={styles.trackInfo}>
        <Text style={styles.trackName} numberOfLines={1}>
          {track.name}
        </Text>
        <Text style={styles.trackArtist} numberOfLines={1}>
          {artists}
        </Text>
      </View>
      <Text style={styles.trackDuration}>{duration}</Text>
    </View>
  );
}

export default function LibraryScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"tracks" | "playlists">("tracks");

  const tracksQuery = useQuery({
    queryKey: ["library-tracks", page, search],
    queryFn: () => getLibraryTracks(page, 50, search || undefined),
    enabled: tab === "tracks",
  });

  const playlistsQuery = useQuery({
    queryKey: ["library-playlists"],
    queryFn: getPlaylists,
    enabled: tab === "playlists",
  });

  const renderTrack = useCallback(
    ({ item }: { item: LibraryTrack }) => <TrackRow track={item} />,
    []
  );

  return (
    <View style={styles.container}>
      {/* Tab Switcher */}
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tabButton, tab === "tracks" && styles.tabButtonActive]}
          onPress={() => setTab("tracks")}
        >
          <Text
            style={[
              styles.tabButtonText,
              tab === "tracks" && styles.tabButtonTextActive,
            ]}
          >
            Liked Songs
            {tracksQuery.data ? ` (${tracksQuery.data.total})` : ""}
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.tabButton,
            tab === "playlists" && styles.tabButtonActive,
          ]}
          onPress={() => setTab("playlists")}
        >
          <Text
            style={[
              styles.tabButtonText,
              tab === "playlists" && styles.tabButtonTextActive,
            ]}
          >
            Playlists
            {playlistsQuery.data ? ` (${playlistsQuery.data.total})` : ""}
          </Text>
        </Pressable>
      </View>

      {/* Search */}
      {tab === "tracks" && (
        <TextInput
          style={styles.searchInput}
          placeholder="Search tracks..."
          placeholderTextColor="#666"
          value={search}
          onChangeText={(text) => {
            setSearch(text);
            setPage(1);
          }}
        />
      )}

      {/* Track List */}
      {tab === "tracks" && (
        <>
          {tracksQuery.isLoading ? (
            <ActivityIndicator
              size="large"
              color="#1DB954"
              style={styles.loader}
            />
          ) : (
            <FlatList
              data={tracksQuery.data?.items ?? []}
              renderItem={renderTrack}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl
                  refreshing={tracksQuery.isRefetching}
                  onRefresh={() => tracksQuery.refetch()}
                  tintColor="#1DB954"
                  colors={["#1DB954"]}
                />
              }
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {search
                    ? "No tracks match your search"
                    : "No liked songs yet. Run a library scan!"}
                </Text>
              }
              onEndReached={() => {
                if (
                  tracksQuery.data &&
                  page < tracksQuery.data.totalPages
                ) {
                  setPage((p) => p + 1);
                }
              }}
              onEndReachedThreshold={0.5}
            />
          )}
        </>
      )}

      {/* Playlist List */}
      {tab === "playlists" && (
        <>
          {/* Set Operations Button */}
          <Pressable
            style={styles.setOpsButton}
            onPress={() => router.push("/setops" as any)}
          >
            <FontAwesome name="exchange" size={14} color="#1DB954" />
            <Text style={styles.setOpsText}>Set Operations</Text>
          </Pressable>

          {playlistsQuery.isLoading ? (
            <ActivityIndicator
              size="large"
              color="#1DB954"
              style={styles.loader}
            />
          ) : (
            <FlatList
              data={playlistsQuery.data?.items ?? []}
              renderItem={({ item }) => (
                <View style={styles.trackRow}>
                  {item.imageUrl ? (
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={styles.albumArt}
                    />
                  ) : (
                    <View
                      style={[styles.albumArt, styles.albumArtPlaceholder]}
                    />
                  )}
                  <View style={styles.trackInfo}>
                    <Text style={styles.trackName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.trackArtist}>
                      {item.trackCount} tracks
                    </Text>
                  </View>
                </View>
              )}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl
                  refreshing={playlistsQuery.isRefetching}
                  onRefresh={() => playlistsQuery.refetch()}
                  tintColor="#1DB954"
                  colors={["#1DB954"]}
                />
              }
              ListEmptyComponent={
                <Text style={styles.emptyText}>No playlists found</Text>
              }
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
  },
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  tabButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: "#282828",
  },
  tabButtonActive: {
    backgroundColor: "#1DB954",
  },
  tabButtonText: {
    color: "#b3b3b3",
    fontSize: 14,
    fontWeight: "600",
  },
  tabButtonTextActive: {
    color: "#fff",
  },
  searchInput: {
    backgroundColor: "#282828",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 12,
    fontSize: 14,
  },
  loader: {
    marginTop: 40,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 12,
  },
  albumArt: {
    width: 48,
    height: 48,
    borderRadius: 4,
  },
  albumArtPlaceholder: {
    backgroundColor: "#282828",
  },
  trackInfo: {
    flex: 1,
  },
  trackName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
  },
  trackArtist: {
    color: "#b3b3b3",
    fontSize: 13,
    marginTop: 2,
  },
  trackDuration: {
    color: "#b3b3b3",
    fontSize: 13,
  },
  setOpsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a1a1a",
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: "#282828",
  },
  setOpsText: {
    color: "#1DB954",
    fontSize: 14,
    fontWeight: "600",
  },
  emptyText: {
    color: "#666",
    fontSize: 14,
    textAlign: "center",
    marginTop: 40,
  },
});
