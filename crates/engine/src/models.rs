use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Track {
    pub id: String,
    pub source_type: String,
    pub source_uri: String,
    pub title: String,
    pub artist: String,
    pub duration: f64,
    pub thumbnail_url: String,
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peaks_json: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub volume: f64,
    pub loudness: Option<f64>,
    pub true_peak: Option<f64>,
    pub created_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segment_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_index: Option<usize>,
}

#[derive(Debug, Clone, Default)]
pub struct NewTrack {
    pub id: String,
    pub source_type: String,
    pub source_uri: String,
    pub title: String,
    pub artist: Option<String>,
    pub duration: f64,
    pub thumbnail_url: Option<String>,
    pub file_path: Option<String>,
    pub peaks_json: Option<String>,
    pub status: Option<String>,
    pub error_message: Option<String>,
    pub volume: Option<f64>,
    pub loudness: Option<f64>,
    pub true_peak: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TrackUpdates {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail_url: Option<String>,
    pub file_path: Option<Option<String>>,
    pub peaks_json: Option<Option<String>>,
    pub status: Option<String>,
    pub error_message: Option<Option<String>>,
    pub volume: Option<f64>,
    pub loudness: Option<Option<f64>>,
    pub true_peak: Option<Option<f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Segment {
    pub id: String,
    pub track_id: String,
    pub name: String,
    pub start_time: f64,
    pub end_time: f64,
    pub color: String,
    pub sort_order: i64,
    pub created_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct NewSegment {
    pub id: String,
    pub track_id: String,
    pub name: String,
    pub start_time: f64,
    pub end_time: f64,
    pub color: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SegmentUpdates {
    pub name: Option<String>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub color: Option<String>,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_custom_ordered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_mix: Option<bool>,
    pub cover_track_id: Option<String>,
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_count: Option<i64>,
    pub cover_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mosaic_urls: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlaylistItem {
    pub id: String,
    pub playlist_id: String,
    pub track_id: String,
    pub segment_id: Option<String>,
    pub sort_order: i64,
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlaylistItemWithDetails {
    pub id: String,
    pub playlist_id: String,
    pub track_id: String,
    pub segment_id: Option<String>,
    pub sort_order: i64,
    pub added_at: i64,
    pub track: Track,
    pub segment: Option<Segment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlaylistMembership {
    pub playlist_id: String,
    pub item_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BatchPlaylistItemInput {
    #[serde(rename = "trackId", alias = "track_id")]
    pub track_id: String,
    #[serde(rename = "segmentId", alias = "segment_id")]
    pub segment_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlayRecord {
    pub track_id: String,
    pub segment_id: Option<String>,
    pub source_type: String,
    pub playlist_id: Option<String>,
    pub via_home: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecentlyPlayedItem {
    pub source_type: String,
    pub playlist_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HeavyRotationItem {
    pub track_id: String,
    pub plays: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TopPlaylistItem {
    pub playlist_id: String,
    pub plays: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HomeSummary {
    pub recently_played: Vec<RecentlyPlayedItem>,
    pub heavy_rotation: Vec<HeavyRotationItem>,
    pub top_playlists: Vec<TopPlaylistItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogEntry {
    pub id: String,
    pub timestamp: i64,
    pub level: String,
    pub category: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}
