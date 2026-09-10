use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use std::sync::mpsc::Sender;

use std::sync::RwLock;
use once_cell::sync::Lazy;

#[derive(Clone, Debug)]
pub struct AudioSegment {
    pub id: String,          // UUIDv4
    pub timestamp: u64,      // Unix Epoch (milissegundos)
    pub text: String,        // Transcrição bruta higienizada
    pub duration_ms: u32,
}

pub type HotRingBufferType = Arc<Mutex<VecDeque<AudioSegment>>>;

pub static GLOBAL_RING_BUFFER: Lazy<Arc<RwLock<Option<HotRingBuffer>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

pub fn set_global_ring_buffer(rb: HotRingBuffer) {
    if let Ok(mut lock) = GLOBAL_RING_BUFFER.write() {
        *lock = Some(rb);
    }
}

pub fn push_to_global_ring_buffer(segment: AudioSegment) {
    if let Ok(guard) = GLOBAL_RING_BUFFER.read() {
        if let Some(ref rb) = *guard {
            rb.insert(segment);
        }
    }
}

pub fn clear_global_ring_buffer() {
    if let Ok(guard) = GLOBAL_RING_BUFFER.read() {
        if let Some(ref rb) = *guard {
            rb.clear();
        }
    }
}

pub struct HotRingBuffer {
    buffer: HotRingBufferType,
    expired_sender: Sender<AudioSegment>,
}

impl HotRingBuffer {
    pub fn new(expired_sender: Sender<AudioSegment>) -> Self {
        Self {
            buffer: Arc::new(Mutex::new(VecDeque::new())),
            expired_sender,
        }
    }

    pub fn get_buffer(&self) -> HotRingBufferType {
        self.buffer.clone()
    }

    pub fn insert(&self, segment: AudioSegment) {
        let mut queue = match self.buffer.lock() {
            Ok(guard) => guard,
            Err(_) => panic!("FATAL: RingBuffer Mutex poisoned"),
        };

        queue.push_back(segment);

        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let threshold = current_time.saturating_sub(60000);

        while let Some(front) = queue.front() {
            if front.timestamp < threshold {
                if let Some(expired) = queue.pop_front() {
                    let _ = self.expired_sender.send(expired);
                }
            } else {
                break;
            }
        }
    }

    pub fn clear(&self) {
        if let Ok(mut queue) = self.buffer.lock() {
            queue.clear();
        }
    }
}
