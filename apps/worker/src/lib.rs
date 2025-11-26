//! SwiftGrid Worker Library
//!
//! A high-performance workflow execution engine built in Rust.
//!
//! ## Module Structure
//!
//! - `types`: Shared types (typeshare'd with TypeScript frontend)
//! - `events`: Event logging for observability
//! - `streaming`: Real-time output streaming via Redis/PostgreSQL
//! - `retry`: Exponential backoff retry logic
//! - `scheduler`: Background job scheduler
//! - `nodes`: Node type execution handlers

pub mod events;
pub mod nodes;
pub mod retry;
pub mod scheduler;
pub mod streaming;
pub mod types;

// Re-export commonly used items
pub use events::{log_event, EventType};
pub use retry::{calculate_backoff, is_retryable_error};
pub use streaming::StreamContext;
pub use types::*;
