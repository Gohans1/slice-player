use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub fn weak_etag(body: &str) -> String {
    let mut h1 = DefaultHasher::new();
    0x9e3779b9u64.hash(&mut h1);
    body.hash(&mut h1);
    let d1 = h1.finish();

    let mut h2 = DefaultHasher::new();
    0x85ebca6bu64.hash(&mut h2);
    body.as_bytes().iter().rev().for_each(|b| b.hash(&mut h2));
    let d2 = h2.finish();

    format!("W/\"{:x}-{:x}-{:x}\"", body.len(), d1, d2)
}

pub fn if_none_match_matches(header: Option<&str>, current_tag: &str) -> bool {
    let Some(raw) = header else {
        return false;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed == "*" {
        return true;
    }

    let normalize = |tag: &str| -> String {
        let t = tag.trim();
        if let Some(rest) = t.strip_prefix("W/").or_else(|| t.strip_prefix("w/")) {
            rest.to_string()
        } else {
            t.to_string()
        }
    };

    let target = normalize(current_tag);
    let bytes = trimmed.as_bytes();
    let mut start = 0usize;
    let mut in_quotes = false;
    for i in 0..=bytes.len() {
        let ch = bytes.get(i).copied();
        if ch == Some(b'"') {
            in_quotes = !in_quotes;
        } else if (ch == Some(b',') && !in_quotes) || i == bytes.len() {
            let candidate = &trimmed[start..i];
            if normalize(candidate) == target {
                return true;
            }
            start = i + 1;
        }
    }
    false
}
