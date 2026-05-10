import { NextRequest, NextResponse } from 'next/server';
import db, { queries } from '@/lib/db';
import { getDemoPlaylist } from '@/lib/demo-data';
import { authErrorResponse, isDemoSessionEnabled, requireMutationAuth } from '@/lib/auth-policy';

interface RouteParams {
  params: Promise<{ id: string }>
}

export const GET = async (req: NextRequest, { params }: RouteParams) => {
  try {
    const { id } = await params;
    const playlist = db.prepare(`
      SELECT id, name, description, created_at, updated_at,
        (
          (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = playlists.id) +
          (SELECT COUNT(*) FROM playlist_youtube_tracks WHERE playlist_id = playlists.id)
        ) as track_count
      FROM playlists
      WHERE id = ?
    `).get(id);

    if (!playlist) {
      const demoPlaylist = isDemoSessionEnabled() ? getDemoPlaylist(id) : null;
      if (demoPlaylist) {
        return NextResponse.json(demoPlaylist);
      }
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    return NextResponse.json(playlist);
  } catch (error) {
    console.error('Error fetching playlist:', error);
    return NextResponse.json({ error: 'Failed to fetch playlist' }, { status: 500 });
  }
};

export const PUT = async (req: NextRequest, { params }: RouteParams) => {
  try {
    await requireMutationAuth(req);
    const { id } = await params;
    const { name, description } = await req.json();

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Playlist name is required' }, { status: 400 });
    }
    
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE playlists
      SET name = ?, description = ?, updated_at = ?
      WHERE id = ?
    `).run(name.trim(), description?.trim() || null, now, id);

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    const playlist = db.prepare(`
      SELECT id, name, description, created_at, updated_at,
        (
          (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = playlists.id) +
          (SELECT COUNT(*) FROM playlist_youtube_tracks WHERE playlist_id = playlists.id)
        ) as track_count
      FROM playlists
      WHERE id = ?
    `).get(id);

    return NextResponse.json(playlist);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error updating playlist:', error);
    return NextResponse.json({ error: 'Failed to update playlist' }, { status: 500 });
  }
};

export const DELETE = async (req: NextRequest, { params }: RouteParams) => {
  try {
    await requireMutationAuth(req);
    const { id } = await params;
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(id);
    db.prepare('DELETE FROM playlist_youtube_tracks WHERE playlist_id = ?').run(id);
    db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error deleting playlist:', error);
    return NextResponse.json({ error: 'Failed to delete playlist' }, { status: 500 });
  }
};
