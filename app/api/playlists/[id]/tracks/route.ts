import { NextRequest, NextResponse } from 'next/server';
import db, { queries } from '@/lib/db';
import { getDemoPlaylistTracks } from '@/lib/demo-data';
import { authErrorResponse, isDemoSessionEnabled, requireMutationAuth } from '@/lib/auth-policy';

interface RouteParams {
  params: Promise<{ id: string }>
}

export const GET = async (req: NextRequest, { params }: RouteParams) => {
  try {
    const { id } = await params;
    const tracks = db.prepare(`
      SELECT t.* FROM tracks t
      JOIN playlist_tracks pt ON t.id = pt.track_id
      WHERE pt.playlist_id = ?
      ORDER BY pt.position ASC
    `).all(id);

    return NextResponse.json(tracks.length > 0 ? tracks : isDemoSessionEnabled() ? getDemoPlaylistTracks(id) : []);
  } catch (error) {
    console.error('Error fetching playlist tracks:', error);
    return NextResponse.json({ error: 'Failed to fetch playlist tracks' }, { status: 500 });
  }
};

export const POST = async (req: NextRequest, { params }: RouteParams) => {
  try {
    await requireMutationAuth(req);
    const { id } = await params;
    const { track_id } = await req.json();
    const trackId = Number(track_id);

    if (!Number.isInteger(trackId)) {
      return NextResponse.json({ error: 'Valid track_id is required' }, { status: 400 });
    }

    const existing = db.prepare(`
      SELECT id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?
    `).get(id, trackId);

    if (existing) {
      return NextResponse.json({ success: true, alreadyAdded: true });
    }

    const maxPosition = db.prepare(`
      SELECT MAX(position) as max_pos FROM playlist_tracks WHERE playlist_id = ?
    `).get(id) as any;

    const position = (maxPosition?.max_pos || 0) + 1;

    db.prepare(`
      INSERT INTO playlist_tracks (playlist_id, track_id, position)
      VALUES (?, ?, ?)
    `).run(id, trackId, position);

    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);

    return NextResponse.json({ success: true, position });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error adding track to playlist:', error);
    return NextResponse.json({ error: 'Failed to add track' }, { status: 500 });
  }
};

export const DELETE = async (req: NextRequest, { params }: RouteParams) => {
  try {
    await requireMutationAuth(req);
    const { id } = await params;
    const { track_id } = await req.json();
    const trackId = Number(track_id);

    if (!Number.isInteger(trackId)) {
      return NextResponse.json({ error: 'Valid track_id is required' }, { status: 400 });
    }

    db.prepare(`
      DELETE FROM playlist_tracks
      WHERE playlist_id = ? AND track_id = ?
    `).run(id, trackId);

    db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error removing track from playlist:', error);
    return NextResponse.json({ error: 'Failed to remove track' }, { status: 500 });
  }
};
