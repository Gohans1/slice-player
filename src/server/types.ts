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
  error_message?: string;
  created_at?: number;
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
  created_at?: number;
}

export interface PlaylistItem {
  id: string;
  playlist_id: string;
  segment_id: string;
  sort_order: number;
}

export interface VirtualPlaylistItem {
  segment: Segment;
  track: Track;
}
