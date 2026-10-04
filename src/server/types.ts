export type SourceType = 'youtube' | 'local';
export type TrackStatus = 'queued' | 'downloading' | 'ready' | 'error';

export interface Track {
  id: string;
  source_type: SourceType;
  source_uri: string;
  title: string;
  artist?: string;
  duration: number; // in seconds
  thumbnail_url?: string;
  file_path?: string;
  peaks_json?: string; // 1000-peak JSON array
  status: TrackStatus;
  error_message?: string | null;
  volume?: number; // 0.0 - 1.0, default 0.5
  created_at?: number;
  segment_count?: number;
  download_index?: number;
}

export interface Segment {
  id: string;
  track_id: string;
  name: string;
  start_time: number; // in seconds
  end_time: number;   // in seconds
  color?: string;
  sort_order?: number;
  created_at?: number;
}


export interface Playlist {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  item_count?: number;
  is_custom_ordered?: boolean;
  cover_track_id?: string | null;
  // Resolved by listPlaylists(): chosen cover thumbnail, else up to 4 thumbnails for a 2x2 mosaic
  cover_url?: string | null;
  mosaic_urls?: string[];
  // Mix playlists own no items: they show their source playlists' items live, in source order
  is_mix?: boolean;
  source_ids?: string[];
  // Sub-playlists (1-level nesting): id of the parent playlist if this is a sub-playlist
  parent_id?: string | null;
}

export interface PlaylistItem {
  id: string;
  playlist_id: string;
  track_id: string;
  segment_id: string | null;
  sort_order: number;
  added_at: number;
}

export interface PlaylistItemWithDetails extends PlaylistItem {
  track: Track;
  segment?: Segment | null;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'success';
export type LogCategory = 'download' | 'playback' | 'system';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: unknown;
}

