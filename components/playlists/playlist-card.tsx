'use client';

import Link from 'next/link';
import { Music } from 'lucide-react';

interface PlaylistCardProps {
  id: string;
  name: string;
  description?: string;
  track_count: number;
}

export function PlaylistCard({ id, name, description, track_count }: PlaylistCardProps) {
  return (
    <Link href={`/playlists/${id}`}>
      <div className="bg-surface rounded-lg p-4 hover:bg-surface-hover transition-colors cursor-pointer group">
        <div className="w-full aspect-square bg-gradient-to-br from-primary/20 to-primary/10 rounded-md mb-4 flex items-center justify-center">
          <Music className="w-12 h-12 text-primary/50" />
        </div>
        <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">{name}</h3>
        {description && <p className="text-sm text-muted-foreground truncate mt-1">{description}</p>}
        <p className="text-xs text-muted-foreground mt-2">{track_count} songs</p>
      </div>
    </Link>
  );
}
