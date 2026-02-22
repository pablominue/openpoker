import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface PlayerContextValue {
  players: string[];
  selectedPlayer: string | null;
  setSelectedPlayer: (name: string) => void;
  refreshPlayers: () => Promise<void>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

const PLAYER_KEY = 'texassolver-player';

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [players, setPlayers] = useState<string[]>([]);
  const [selectedPlayer, setSelectedPlayerState] = useState<string | null>(
    () => localStorage.getItem(PLAYER_KEY)
  );

  const refreshPlayers = async () => {
    try {
      const res = await fetch('/api/hands/players');
      if (res.ok) {
        const data: string[] = await res.json();
        setPlayers(data);
      }
    } catch {
      // network error — ignore
    }
  };

  useEffect(() => {
    refreshPlayers();
  }, []);

  const setSelectedPlayer = (name: string) => {
    localStorage.setItem(PLAYER_KEY, name);
    setSelectedPlayerState(name);
  };

  return (
    <PlayerContext.Provider value={{ players, selectedPlayer, setSelectedPlayer, refreshPlayers }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
