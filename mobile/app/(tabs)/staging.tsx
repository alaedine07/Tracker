import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  RefreshControl,
  Switch,
  Keyboard,
  TouchableWithoutFeedback,
} from "react-native";
import { Image } from "expo-image";
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import {
  getStagingBins,
  getBinDetail,
  deleteBin,
  pushBinToSpotify,
  reorderBinTracks,
  removeTracksFromBin,
  addTracksToBin,
  updateBin,
  BinTrack,
  StagingBin,
  StagingBinDetail,
} from "../../src/api/staging";
import {
  getVibeSuggestions,
  generateVibe,
} from "../../src/api/vibe";

// ──── Track Row with Selection ────

function TrackRow({
  track,
  isSelecting,
  isSelected,
  onToggleSelect,
  drag,
  isActive,
}: {
  track: BinTrack;
  isSelecting: boolean;
  isSelected: boolean;
  onToggleSelect: (trackId: string) => void;
  drag?: () => void;
  isActive?: boolean;
}) {
  const artists = track.artistNames?.join(", ") ?? "Unknown";
  const duration = track.durationMs
    ? `${Math.floor(track.durationMs / 60000)}:${String(
        Math.floor((track.durationMs % 60000) / 1000)
      ).padStart(2, "0")}`
    : "";

  return (
    <Pressable
      style={[
        styles.trackRow,
        isActive && styles.trackRowDragging,
        isSelected && styles.trackRowSelected,
      ]}
      onLongPress={drag}
      onPress={() => {
        if (isSelecting) {
          onToggleSelect(track.trackId);
        }
      }}
    >
      {isSelecting && (
        <Pressable
          style={[styles.checkbox, isSelected && styles.checkboxSelected]}
          onPress={() => onToggleSelect(track.trackId)}
        >
          {isSelected && <FontAwesome name="check" size={10} color="#fff" />}
        </Pressable>
      )}
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
      {!isSelecting && drag && (
        <Pressable onPressIn={drag} style={styles.dragHandle}>
          <FontAwesome name="bars" size={14} color="#555" />
        </Pressable>
      )}
    </Pressable>
  );
}

// ──── Bin Card ────

function BinCard({
  bin,
  isExpanded,
  onToggle,
  onPush,
  onDelete,
  onStartRename,
  allBins,
  isEditing,
  editName,
  onEditNameChange,
  onSaveRename,
  onCancelRename,
}: {
  bin: StagingBin;
  isExpanded: boolean;
  onToggle: () => void;
  onPush: () => void;
  onDelete: () => void;
  onStartRename: () => void;
  allBins: StagingBin[];
  isEditing: boolean;
  editName: string;
  onEditNameChange: (name: string) => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
}) {
  const queryClient = useQueryClient();
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const detailQuery = useQuery({
    queryKey: ["bin-detail", bin.id],
    queryFn: () => getBinDetail(bin.id),
    enabled: isExpanded,
  });

  const reorderMutation = useMutation({
    mutationFn: (trackIds: string[]) => reorderBinTracks(bin.id, trackIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bin-detail", bin.id] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (trackIds: string[]) => removeTracksFromBin(bin.id, trackIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bin-detail", bin.id] });
      queryClient.invalidateQueries({ queryKey: ["staging-bins"] });
      setSelectedIds(new Set());
      setIsSelecting(false);
    },
  });

  const moveMutation = useMutation({
    mutationFn: ({ targetBinId, trackIds }: { targetBinId: string; trackIds: string[] }) =>
      Promise.all([
        removeTracksFromBin(bin.id, trackIds),
        addTracksToBin(targetBinId, trackIds),
      ]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bin-detail"] });
      queryClient.invalidateQueries({ queryKey: ["staging-bins"] });
      setSelectedIds(new Set());
      setIsSelecting(false);
    },
  });

  const toggleSelect = useCallback((trackId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(
    ({ data }: { data: BinTrack[] }) => {
      // Optimistically update cache
      queryClient.setQueryData(
        ["bin-detail", bin.id],
        (old: StagingBinDetail | undefined) =>
          old ? { ...old, tracks: data } : old
      );
      reorderMutation.mutate(data.map((t) => t.trackId));
    },
    [bin.id, queryClient, reorderMutation]
  );

  const handleRemoveSelected = () => {
    if (selectedIds.size === 0) return;
    Alert.alert("Remove Tracks", `Remove ${selectedIds.size} track(s) from this bin?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeMutation.mutate([...selectedIds]) },
    ]);
  };

  const handleMoveSelected = () => {
    if (selectedIds.size === 0) return;
    const otherBins = allBins.filter((b) => b.id !== bin.id);
    if (otherBins.length === 0) {
      Alert.alert("No other bins", "Create another bin first to move tracks.");
      return;
    }
    // Show alert with bin options
    Alert.alert(
      "Move to Bin",
      `Move ${selectedIds.size} track(s) to:`,
      [
        ...otherBins.slice(0, 5).map((b) => ({
          text: b.name,
          onPress: () => moveMutation.mutate({ targetBinId: b.id, trackIds: [...selectedIds] }),
        })),
        { text: "Cancel", style: "cancel" as const },
      ]
    );
  };

  const renderDraggableItem = useCallback(
    ({ item, drag: itemDrag, isActive }: RenderItemParams<BinTrack>) => (
      <ScaleDecorator>
        <TrackRow
          track={item}
          isSelecting={isSelecting}
          isSelected={selectedIds.has(item.trackId)}
          onToggleSelect={toggleSelect}
          drag={itemDrag}
          isActive={isActive}
        />
      </ScaleDecorator>
    ),
    [isSelecting, selectedIds, toggleSelect]
  );

  const tracks = detailQuery.data?.tracks ?? [];

  return (
    <View style={styles.binCard}>
      <Pressable style={styles.binHeader} onPress={onToggle}>
        <View style={styles.binHeaderLeft}>
          <FontAwesome
            name={isExpanded ? "chevron-down" : "chevron-right"}
            size={12}
            color="#b3b3b3"
            style={{ marginRight: 10 }}
          />
          <View style={{ flex: 1 }}>
            {isEditing ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <TextInput
                  style={styles.binNameInput}
                  value={editName}
                  onChangeText={onEditNameChange}
                  autoFocus
                  maxLength={255}
                  onSubmitEditing={onSaveRename}
                />
                <Pressable onPress={onSaveRename} style={styles.renameBtn}>
                  <FontAwesome name="check" size={12} color="#1DB954" />
                </Pressable>
                <Pressable onPress={onCancelRename} style={styles.renameBtn}>
                  <FontAwesome name="times" size={12} color="#e74c3c" />
                </Pressable>
              </View>
            ) : (
              <Pressable onLongPress={onStartRename}>
                <Text style={styles.binName}>{bin.name}</Text>
              </Pressable>
            )}
            <Text style={styles.binMeta}>
              {bin.trackCount} tracks · {bin.source}
            </Text>
          </View>
        </View>
        <View style={styles.binActions}>
          <Pressable style={styles.actionBtn} onPress={onStartRename}>
            <FontAwesome name="pencil" size={14} color="#b3b3b3" />
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={onPush}>
            <FontAwesome name="spotify" size={18} color="#1DB954" />
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={onDelete}>
            <FontAwesome name="trash" size={16} color="#e74c3c" />
          </Pressable>
        </View>
      </Pressable>

      {isExpanded && (
        <View style={styles.binBody}>
          {bin.description ? (
            <Text style={styles.binDescription}>{bin.description}</Text>
          ) : null}

          {/* Bin toolbar */}
          <View style={styles.binToolbar}>
            {tracks.length > 0 && (
              <>
                <Pressable
                  style={[styles.toolBtn, isSelecting && styles.toolBtnActive]}
                  onPress={() => {
                    setIsSelecting(!isSelecting);
                    setSelectedIds(new Set());
                  }}
                >
                  <FontAwesome name="check-square-o" size={14} color={isSelecting ? "#1DB954" : "#888"} />
                  <Text style={[styles.toolBtnText, isSelecting && styles.toolBtnTextActive]}>
                    {isSelecting ? "Cancel" : "Select"}
                  </Text>
                </Pressable>
              </>
            )}
          </View>

          {/* Selection action bar */}
          {isSelecting && selectedIds.size > 0 && (
            <View style={styles.selectionBar}>
              <Text style={styles.selectionText}>{selectedIds.size} selected</Text>
              <Pressable style={styles.selectionAction} onPress={handleMoveSelected}>
                <FontAwesome name="arrow-right" size={12} color="#fff" />
                <Text style={styles.selectionActionText}>Move</Text>
              </Pressable>
              <Pressable style={[styles.selectionAction, styles.selectionActionDanger]} onPress={handleRemoveSelected}>
                <FontAwesome name="times" size={12} color="#fff" />
                <Text style={styles.selectionActionText}>Remove</Text>
              </Pressable>
            </View>
          )}

          {detailQuery.isLoading ? (
            <ActivityIndicator color="#1DB954" style={{ marginVertical: 12 }} />
          ) : detailQuery.isError ? (
            <Text style={styles.errorText}>Failed to load tracks</Text>
          ) : tracks.length > 0 ? (
            <GestureHandlerRootView>
              <DraggableFlatList
                data={tracks}
                renderItem={renderDraggableItem}
                keyExtractor={(item) => item.trackId}
                onDragEnd={handleDragEnd}
                containerStyle={{ maxHeight: 400 }}
              />
            </GestureHandlerRootView>
          ) : (
            <Text style={styles.emptyText}>No tracks in this bin</Text>
          )}
        </View>
      )}
    </View>
  );
}

// ──── Main Screen ────

export default function StagingScreen() {
  const queryClient = useQueryClient();
  const [expandedBinId, setExpandedBinId] = useState<string | null>(null);
  const [vibePrompt, setVibePrompt] = useState("");
  const [showVibeModal, setShowVibeModal] = useState(false);
  const [trackCount, setTrackCount] = useState(25);
  const [includeDiscovery, setIncludeDiscovery] = useState(false);
  const [editingBinId, setEditingBinId] = useState<string | null>(null);
  const [editingBinName, setEditingBinName] = useState("");
  const [selectedChip, setSelectedChip] = useState<string | null>(null);

  // ──── Queries ────
  const binsQuery = useQuery({
    queryKey: ["staging-bins"],
    queryFn: getStagingBins,
  });

  const suggestionsQuery = useQuery({
    queryKey: ["vibe-suggestions"],
    queryFn: getVibeSuggestions,
  });

  // ──── Mutations ────
  const vibeMutation = useMutation({
    mutationFn: (params: { prompt: string; trackCount: number; includeDiscovery: boolean }) =>
      generateVibe(params.prompt, {
        trackCount: params.trackCount,
        includeDiscovery: params.includeDiscovery,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staging-bins"] });
      setVibePrompt("");
      setShowVibeModal(false);
    },
    onError: (err: any) => {
      Alert.alert("Error", err?.response?.data?.error || "Failed to generate vibe");
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ binId, name }: { binId: string; name: string }) =>
      updateBin(binId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staging-bins"] });
      setEditingBinId(null);
      setEditingBinName("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staging-bins"] });
    },
  });

  const pushMutation = useMutation({
    mutationFn: (binId: string) => pushBinToSpotify(binId),
    onSuccess: (data: any) => {
      if (data.warning) {
        Alert.alert(
          "Partial Success",
          `${data.addedTracks ?? 0} of ${data.totalTracks ?? "?"} tracks added. ${data.warning}`
        );
      } else {
        Alert.alert(
          "Playlist Created!",
          `${data.trackCount} tracks pushed to Spotify.`
        );
      }
    },
    onError: (err: any) => {
      Alert.alert("Error", err?.response?.data?.error || "Failed to push to Spotify");
    },
  });

  // ──── Handlers ────
  const handlePush = (bin: StagingBin) => {
    Alert.alert(
      "Push to Spotify",
      `Create a new Spotify playlist "${bin.name}" with ${bin.trackCount} tracks?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Push", onPress: () => pushMutation.mutate(bin.id) },
      ]
    );
  };

  const handleDelete = (bin: StagingBin) => {
    Alert.alert("Delete Bin", `Delete "${bin.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteMutation.mutate(bin.id),
      },
    ]);
  };

  const handleVibeSubmit = () => {
    if (vibePrompt.trim()) {
      vibeMutation.mutate({
        prompt: vibePrompt.trim(),
        trackCount,
        includeDiscovery,
      });
    }
  };

  const bins = binsQuery.data?.items ?? [];

  return (
    <View style={styles.container}>
      {/* Vibe Generate Button */}
      <Pressable
        style={styles.vibeButton}
        onPress={() => setShowVibeModal(true)}
      >
        <FontAwesome name="magic" size={16} color="#000" />
        <Text style={styles.vibeButtonText}>Generate Vibe Playlist</Text>
      </Pressable>

      {/* Bins List */}
      {binsQuery.isLoading ? (
        <ActivityIndicator size="large" color="#1DB954" style={styles.loader} />
      ) : binsQuery.isError ? (
        <View style={styles.emptyContainer}>
          <FontAwesome name="exclamation-triangle" size={40} color="#e74c3c" />
          <Text style={styles.errorTitle}>Failed to load bins</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => binsQuery.refetch()}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : bins.length > 0 ? (
        <FlatList
          data={bins}
          renderItem={({ item }) => (
            <BinCard
              bin={item}
              isExpanded={expandedBinId === item.id}
              onToggle={() =>
                setExpandedBinId(expandedBinId === item.id ? null : item.id)
              }
              onPush={() => handlePush(item)}
              onDelete={() => handleDelete(item)}
              onStartRename={() => {
                setEditingBinId(item.id);
                setEditingBinName(item.name);
              }}
              allBins={bins}
              isEditing={editingBinId === item.id}
              editName={editingBinName}
              onEditNameChange={setEditingBinName}
              onSaveRename={() => {
                if (editingBinName.trim()) {
                  renameMutation.mutate({ binId: item.id, name: editingBinName.trim() });
                }
              }}
              onCancelRename={() => {
                setEditingBinId(null);
                setEditingBinName("");
              }}
            />
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={binsQuery.isRefetching}
              onRefresh={() => binsQuery.refetch()}
              tintColor="#1DB954"
              colors={["#1DB954"]}
            />
          }
        />
      ) : (
        <View style={styles.emptyContainer}>
          <FontAwesome name="inbox" size={48} color="#333" />
          <Text style={styles.emptyTitle}>No bins yet</Text>
          <Text style={styles.emptySubtext}>
            Generate a vibe playlist or use set operations to create bins
          </Text>
        </View>
      )}

      {/* Vibe Modal */}
      <Modal
        visible={showVibeModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowVibeModal(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Generate Vibe</Text>
            <Pressable onPress={() => setShowVibeModal(false)}>
              <FontAwesome name="close" size={20} color="#b3b3b3" />
            </Pressable>
          </View>

          <Text style={styles.modalSubtitle}>
            Describe a mood or vibe and AI will create a playlist from your library
          </Text>

          <TextInput
            style={styles.vibeInput}
            placeholder="e.g., Late night chill study session..."
            placeholderTextColor="#666"
            value={vibePrompt}
            onChangeText={setVibePrompt}
            multiline
            maxLength={500}
          />

          {/* Track Count Selector */}
          <View style={styles.optionSection}>
            <Text style={styles.chipSectionTitle}>Number of tracks</Text>
            <View style={styles.trackCountRow}>
              {[10, 20, 30, 50].map((n) => (
                <Pressable
                  key={n}
                  style={[
                    styles.trackCountBtn,
                    trackCount === n && styles.trackCountBtnActive,
                  ]}
                  onPress={() => setTrackCount(n)}
                >
                  <Text
                    style={[
                      styles.trackCountText,
                      trackCount === n && styles.trackCountTextActive,
                    ]}
                  >
                    {n}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Discovery Toggle */}
          <View style={styles.discoveryRow}>
            <View style={styles.discoveryTextContainer}>
              <Text style={styles.discoveryLabel}>Include new discoveries</Text>
              <Text style={styles.discoveryHint}>Add songs not in your library</Text>
            </View>
            <Switch
              value={includeDiscovery}
              onValueChange={setIncludeDiscovery}
              trackColor={{ false: "#333", true: "#1a5e35" }}
              thumbColor={includeDiscovery ? "#1DB954" : "#888"}
            />
          </View>

          {/* Suggestion Chips */}
          {suggestionsQuery.data?.vibePrompts && (
            <View>
              <Text style={styles.chipSectionTitle}>Try these vibes</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipRow}
              >
                {suggestionsQuery.data.vibePrompts.map((prompt) => (
                  <Pressable
                    key={prompt}
                    style={[styles.chip, selectedChip === prompt && styles.chipSelected]}
                    onPress={() => {
                      setSelectedChip(selectedChip === prompt ? null : prompt);
                      setVibePrompt(selectedChip === prompt ? "" : prompt);
                    }}
                  >
                    <Text style={[styles.chipText, selectedChip === prompt && styles.chipTextSelected]}>{prompt}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Genre/Mood Suggestions */}
          {suggestionsQuery.data?.suggestions &&
            suggestionsQuery.data.suggestions.length > 0 && (
              <View>
                <Text style={styles.chipSectionTitle}>Your top genres & moods</Text>
                <View style={styles.chipWrap}>
                  {suggestionsQuery.data.suggestions.slice(0, 12).map((s) => (
                    <Pressable
                      key={`${s.type}-${s.label}`}
                      style={[styles.chip, selectedChip === `${s.type}-${s.label}` && styles.chipSelected]}
                      onPress={() => {
                        const key = `${s.type}-${s.label}`;
                        setSelectedChip(selectedChip === key ? null : key);
                        setVibePrompt(selectedChip === key ? "" : `${s.label} vibes`);
                      }}
                    >
                      <Text style={[styles.chipText, selectedChip === `${s.type}-${s.label}` && styles.chipTextSelected]}>
                        {s.label} ({s.trackCount})
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

          <Pressable
            style={[
              styles.generateButton,
              (!vibePrompt.trim() || vibeMutation.isPending) &&
                styles.generateButtonDisabled,
            ]}
            onPress={handleVibeSubmit}
            disabled={!vibePrompt.trim() || vibeMutation.isPending}
          >
            {vibeMutation.isPending ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.generateButtonText}>
                Generate Playlist
              </Text>
            )}
          </Pressable>
        </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

// ──── Styles ────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
  },
  loader: {
    marginTop: 40,
  },
  listContent: {
    padding: 12,
  },

  // Vibe Button
  vibeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1DB954",
    margin: 12,
    marginBottom: 0,
    padding: 14,
    borderRadius: 25,
    gap: 8,
  },
  vibeButtonText: {
    color: "#000",
    fontWeight: "bold",
    fontSize: 15,
  },

  // Bins
  binCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    marginBottom: 10,
    overflow: "hidden",
  },
  binHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
  },
  binHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  binName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  binNameInput: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: "#1DB954",
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  renameBtn: {
    padding: 6,
  },
  binMeta: {
    color: "#b3b3b3",
    fontSize: 12,
    marginTop: 2,
  },
  binActions: {
    flexDirection: "row",
    gap: 12,
  },
  actionBtn: {
    padding: 6,
  },
  binBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: "#282828",
  },
  binDescription: {
    color: "#b3b3b3",
    fontSize: 13,
    fontStyle: "italic",
    marginBottom: 8,
    marginTop: 8,
  },

  // Track Row
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  albumArt: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 10,
  },
  albumArtPlaceholder: {
    backgroundColor: "#333",
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
  trackDuration: {
    color: "#b3b3b3",
    fontSize: 12,
    marginLeft: 8,
  },

  // Empty states
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 16,
  },
  emptySubtext: {
    color: "#b3b3b3",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  emptyText: {
    color: "#666",
    textAlign: "center",
    paddingVertical: 20,
    fontSize: 13,
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: "#121212",
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
  },
  modalSubtitle: {
    color: "#b3b3b3",
    fontSize: 14,
    marginBottom: 20,
  },
  vibeInput: {
    backgroundColor: "#282828",
    color: "#fff",
    borderRadius: 10,
    padding: 16,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: 20,
  },
  chipSectionTitle: {
    color: "#b3b3b3",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  chipRow: {
    marginBottom: 16,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    backgroundColor: "#282828",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  chipMood: {
    backgroundColor: "#1a3a2a",
  },
  chipSelected: {
    backgroundColor: "#1DB954",
  },
  chipTextSelected: {
    color: "#000",
    fontWeight: "600",
  },
  chipText: {
    color: "#fff",
    fontSize: 13,
  },
  optionSection: {
    marginBottom: 16,
  },
  trackCountRow: {
    flexDirection: "row",
    gap: 10,
  },
  trackCountBtn: {
    flex: 1,
    backgroundColor: "#282828",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  trackCountBtnActive: {
    backgroundColor: "#1DB954",
  },
  trackCountText: {
    color: "#b3b3b3",
    fontSize: 15,
    fontWeight: "600",
  },
  trackCountTextActive: {
    color: "#000",
  },
  discoveryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  discoveryTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  discoveryLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
  },
  discoveryHint: {
    color: "#888",
    fontSize: 12,
    marginTop: 2,
  },
  generateButton: {
    backgroundColor: "#1DB954",
    borderRadius: 25,
    padding: 16,
    alignItems: "center",
    marginTop: "auto",
  },
  generateButtonDisabled: {
    opacity: 0.5,
  },
  generateButtonText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "bold",
  },

  // Drag handle
  dragHandle: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 4,
  },
  trackRowDragging: {
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },

  // Selection
  trackRowSelected: {
    backgroundColor: "#1a3a2a",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#555",
    marginRight: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    backgroundColor: "#1DB954",
    borderColor: "#1DB954",
  },

  // Bin toolbar
  binToolbar: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
    marginBottom: 6,
  },
  toolBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: "#282828",
  },
  toolBtnActive: {
    backgroundColor: "#1a3a2a",
  },
  toolBtnText: {
    color: "#888",
    fontSize: 12,
    fontWeight: "500",
  },
  toolBtnTextActive: {
    color: "#1DB954",
  },

  // Selection bar
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    marginBottom: 4,
  },
  selectionText: {
    color: "#1DB954",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  selectionAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#1DB954",
  },
  selectionActionDanger: {
    backgroundColor: "#e74c3c",
  },
  selectionActionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },

  // Error states
  errorText: {
    color: "#e74c3c",
    textAlign: "center",
    paddingVertical: 16,
    fontSize: 13,
  },
  errorTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 12,
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: "#282828",
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 20,
  },
  retryText: {
    color: "#1DB954",
    fontSize: 14,
    fontWeight: "600",
  },
});
