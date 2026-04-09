import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import * as authApi from "../api/auth";

interface User {
  id: string;
  spotify_id: string;
  display_name: string | null;
  email: string;
  avatar_url: string | null;
}

interface AuthState {
  jwt: string | null;
  userId: string | null;
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  // Actions
  setAuth: (jwt: string, user: User) => Promise<void>;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
  loadStoredAuth: () => Promise<void>;
}

const JWT_KEY = "musicmanager_jwt";
const USER_KEY = "musicmanager_user";

export const useAuthStore = create<AuthState>((set, get) => ({
  jwt: null,
  userId: null,
  user: null,
  isLoading: true,
  isAuthenticated: false,

  setAuth: async (jwt: string, user: User) => {
    await SecureStore.setItemAsync(JWT_KEY, jwt);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    set({
      jwt,
      userId: user.id,
      user,
      isAuthenticated: true,
      isLoading: false,
    });
  },

  refreshAuth: async () => {
    const { userId } = get();
    if (!userId) throw new Error("No user ID for refresh");

    const { jwt } = await authApi.refreshToken(userId);
    await SecureStore.setItemAsync(JWT_KEY, jwt);
    set({ jwt });
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout errors
    }
    await SecureStore.deleteItemAsync(JWT_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    set({
      jwt: null,
      userId: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  loadStoredAuth: async () => {
    try {
      const jwt = await SecureStore.getItemAsync(JWT_KEY);
      const userStr = await SecureStore.getItemAsync(USER_KEY);

      if (jwt && userStr) {
        const user: User = JSON.parse(userStr);
        set({
          jwt,
          userId: user.id,
          user,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch {
      set({ isLoading: false });
    }
  },
}));
