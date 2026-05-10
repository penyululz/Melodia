'use client';

import { useEffect, useState } from 'react';
import { PlaylistCard } from '@/components/playlists/playlist-card';
import { CreatePlaylistModal } from '@/components/playlists/create-playlist-modal';

interface Playlist {
  id: string;
  name: string;
  description: string;
  track_count: number;
}

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPlaylists = async () => {
    try {
      const response = await fetch('/api/playlists');
      if (response.ok) {
        setPlaylists(await response.json());
      }
    } catch (error) {
      console.error('Error loading playlists:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlaylists();
  }, []);

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Your Playlists</h1>
          <CreatePlaylistModal onCreated={loadPlaylists} />
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading playlists...</p>
          </div>
        ) : playlists.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">No playlists yet</p>
            <CreatePlaylistModal onCreated={loadPlaylists} />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {playlists.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                id={playlist.id}
                name={playlist.name}
                description={playlist.description}
                track_count={playlist.track_count}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
