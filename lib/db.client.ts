'use client'

// Mock database for client-side use in development/preview
export const mockQueries = {
  getAllTracks: () => ({ all: () => [] }),
  getTrackById: () => ({ get: () => null }),
  getTracksByArtist: () => ({ all: () => [] }),
  getTracksByAlbum: () => ({ all: () => [] }),
  getTracksByGenre: () => ({ all: () => [] }),
  getFavoriteTracks: () => ({ all: () => [] }),
  getRecentTracks: () => ({ all: () => [] }),
  getMostPlayedTracks: () => ({ all: () => [] }),
  searchTracks: () => ({ all: () => [] }),
  getAlbums: () => ({ all: () => [] }),
  getArtists: () => ({ all: () => [] }),
  getGenres: () => ({ all: () => [] }),
  getAllPlaylists: () => ({ all: () => [] }),
  getPlaylistById: () => ({ get: () => null }),
  getPlaylistTracks: () => ({ all: () => [] }),
  getLibraryStats: () => ({ get: () => ({ total_tracks: 0, total_duration: 0, total_artists: 0, total_albums: 0 }) }),
}
