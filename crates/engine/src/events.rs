use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

pub type EventListener = Arc<dyn Fn(&Value) + Send + Sync + 'static>;

pub const FORWARDED_EVENT_TYPES: [&str; 14] = [
    "track_updated",
    "track_created",
    "track_deleted",
    "tracks_deleted",
    "segment_deleted",
    "segment_updated",
    "segments_deleted",
    "playlist_created",
    "playlist_updated",
    "playlist_deleted",
    "playlist_items_changed",
    "app_log",
    "logs_cleared",
    "library_restored",
];

#[derive(Default, Clone)]
pub struct EventBus {
    inner: Arc<Mutex<EventBusInner>>,
}

#[derive(Default)]
struct EventBusInner {
    next_id: u64,
    listeners: HashMap<String, Vec<(u64, EventListener)>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn on<F>(&self, event: &str, f: F) -> u64
    where
        F: Fn(&Value) + Send + Sync + 'static,
    {
        let mut guard = self.inner.lock().unwrap();
        guard.next_id += 1;
        let id = guard.next_id;
        guard
            .listeners
            .entry(event.to_string())
            .or_default()
            .push((id, Arc::new(f)));
        id
    }

    pub fn off(&self, event: &str, id: u64) {
        let mut guard = self.inner.lock().unwrap();
        if let Some(list) = guard.listeners.get_mut(event) {
            list.retain(|(listener_id, _)| *listener_id != id);
            if list.is_empty() {
                guard.listeners.remove(event);
            }
        }
    }

    pub fn emit(&self, event: &str, payload: Value) {
        let listeners: Vec<EventListener> = {
            let guard = self.inner.lock().unwrap();
            guard
                .listeners
                .get(event)
                .map(|v| v.iter().map(|(_, l)| l.clone()).collect())
                .unwrap_or_default()
        };
        for listener in listeners {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                listener(&payload);
            }));
        }
    }
}

pub fn server_events() -> &'static EventBus {
    static GLOBAL_EVENTS: OnceLock<EventBus> = OnceLock::new();
    GLOBAL_EVENTS.get_or_init(EventBus::new)
}

pub fn forward_server_events_on<F>(bus: &EventBus, broadcast: F) -> Box<dyn FnOnce() + Send>
where
    F: Fn(Value) + Send + Sync + 'static,
{
    let broadcast = Arc::new(broadcast);
    let mut subscriptions = Vec::with_capacity(FORWARDED_EVENT_TYPES.len());
    for &event_type in &FORWARDED_EVENT_TYPES {
        let b = broadcast.clone();
        let ev_name = event_type.to_string();
        let id = bus.on(event_type, move |payload| {
            let mut msg = Map::new();
            msg.insert("type".to_string(), Value::String(ev_name.clone()));
            if let Value::Object(map) = payload {
                for (k, v) in map {
                    if k != "type" {
                        msg.insert(k.clone(), v.clone());
                    }
                }
            }
            b(Value::Object(msg));
        });
        subscriptions.push((event_type.to_string(), id));
    }
    let bus_clone = bus.clone();
    Box::new(move || {
        for (event_type, id) in subscriptions {
            bus_clone.off(&event_type, id);
        }
    })
}

pub fn forward_server_events<F>(broadcast: F) -> Box<dyn FnOnce() + Send>
where
    F: Fn(Value) + Send + Sync + 'static,
{
    forward_server_events_on(server_events(), broadcast)
}
