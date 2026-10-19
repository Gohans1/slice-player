use crate::db::parse_play_record;
use crate::http::security::MAX_JSON_PAYLOAD_BYTES;
use crate::http::{parse_json_bytes, AppState};
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

pub async fn record_play_handler(State(state): State<AppState>, body: Bytes) -> Response {
    let val: Value = match parse_json_bytes(&body, MAX_JSON_PAYLOAD_BYTES) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let Some(play) = parse_play_record(&val) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid play" })),
        )
            .into_response();
    };
    match state.db.record_play(&play) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Track not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}

pub async fn get_home_handler(State(state): State<AppState>) -> Response {
    match state.db.get_home_summary(None) {
        Ok(summary) => Json(summary).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e })),
        )
            .into_response(),
    }
}
