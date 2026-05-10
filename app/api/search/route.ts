import { NextRequest, NextResponse } from 'next/server';
import db, { type Track, type YTTrack } from '@/lib/db';
import { getSessionOrDemo } from '@/lib/auth-policy';
import {
  buildTasteProfile,
  rankLocalSearchResults,
  recordSearchSignal,
} from '@/lib/recommendation-engine';

export const GET = async (req: NextRequest) => {
  try {
    const query = req.nextUrl.searchParams.get('q')?.toLowerCase() || '';
    
    if (query.length < 2) {
      return NextResponse.json({ tracks: [], albums: [], artists: [], genres: [] });
    }

    let tracks = db.prepare(`
      SELECT * FROM tracks
      WHERE LOWER(title) LIKE ?
        OR LOWER(artist) LIKE ?
        OR LOWER(album) LIKE ?
        OR LOWER(genre) LIKE ?
        OR LOWER(mood) LIKE ?
        OR LOWER(style) LIKE ?
        OR LOWER(language) LIKE ?
        OR LOWER(podcast_title) LIKE ?
        OR LOWER(podcast_author) LIKE ?
        OR LOWER(podcast_description) LIKE ?
      LIMIT 20
    `).all(
      `%${query}%`,
      `%${query}%`,
      `%${query}%`,
      `%${query}%`,
      `%${query}%`,
      `%${query}%`,
      `%${query}%`,
      `%${query}%`,
      `%${query}%`,
      `%${query}%`
    ) as Track[];
    const user = await getSessionOrDemo(req)
    const ytTracks = db.prepare("SELECT * FROM yt_tracks ORDER BY created_at DESC").all() as YTTrack[]
    const profile = buildTasteProfile(user?.id ?? null, tracks, ytTracks, req)
    tracks = rankLocalSearchResults(tracks, query, profile)

    const albums = db.prepare(`
      SELECT DISTINCT album, artist, 
        (SELECT COUNT(*) FROM tracks WHERE LOWER(album) LIKE ? AND artist = albums.artist AND COALESCE(content_type, 'music') != 'podcast') as track_count
      FROM (SELECT DISTINCT album, artist FROM tracks WHERE LOWER(album) LIKE ? AND COALESCE(content_type, 'music') != 'podcast') AS albums
      ORDER BY track_count DESC LIMIT 10
    `).all(`%${query}%`, `%${query}%`) as any[];

    const artists = db.prepare(`
      SELECT DISTINCT artist,
        (SELECT COUNT(*) FROM tracks WHERE artist = artists.artist AND COALESCE(content_type, 'music') != 'podcast') as track_count
      FROM (SELECT DISTINCT artist FROM tracks WHERE LOWER(artist) LIKE ? AND COALESCE(content_type, 'music') != 'podcast') AS artists
      ORDER BY track_count DESC LIMIT 10
    `).all(`%${query}%`) as any[];

    const genres = db.prepare(`
      SELECT DISTINCT genre,
        (SELECT COUNT(*) FROM tracks WHERE genre = genres.genre AND COALESCE(content_type, 'music') != 'podcast') as track_count
      FROM (SELECT DISTINCT genre FROM tracks WHERE LOWER(genre) LIKE ? AND COALESCE(content_type, 'music') != 'podcast') AS genres
      ORDER BY track_count DESC LIMIT 10
    `).all(`%${query}%`) as any[];

    recordSearchSignal(user?.id ?? null, query, "all", tracks.length + albums.length + artists.length + genres.length, req)

    return NextResponse.json({ tracks, albums, artists, genres });
  } catch (error) {
    console.error('Error searching:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
};
