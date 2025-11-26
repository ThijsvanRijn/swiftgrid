//! Retry logic with exponential backoff.
//!
//! Handles transient failures by automatically retrying with increasing delays.

use rand::Rng;
use std::time::Duration;

/// Calculate exponential backoff with jitter.
///
/// Uses the formula: 2^attempt * 1000ms + random(0-500ms)
/// - Attempt 1: 2s + jitter
/// - Attempt 2: 4s + jitter
/// - Attempt 3: 8s + jitter
/// - Attempt 4: 16s + jitter
pub fn calculate_backoff(attempt: u32) -> Duration {
    let base_ms = 2u64.pow(attempt) * 1000;
    let jitter_ms = rand::rng().random_range(0..=500);
    Duration::from_millis(base_ms + jitter_ms)
}

/// Check if an HTTP status code indicates a retryable error.
///
/// Retryable errors are transient and may succeed on retry:
/// - 408: Request Timeout
/// - 429: Too Many Requests (rate limited)
/// - 500: Internal Server Error
/// - 502: Bad Gateway
/// - 503: Service Unavailable
/// - 504: Gateway Timeout
pub fn is_retryable_error(status_code: u16) -> bool {
    matches!(status_code, 408 | 429 | 500 | 502 | 503 | 504)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backoff_increases() {
        let b1 = calculate_backoff(1);
        let b2 = calculate_backoff(2);
        let b3 = calculate_backoff(3);

        // Base values: 2s, 4s, 8s (before jitter)
        assert!(b1.as_millis() >= 2000 && b1.as_millis() <= 2500);
        assert!(b2.as_millis() >= 4000 && b2.as_millis() <= 4500);
        assert!(b3.as_millis() >= 8000 && b3.as_millis() <= 8500);
    }

    #[test]
    fn test_retryable_errors() {
        assert!(is_retryable_error(408));
        assert!(is_retryable_error(429));
        assert!(is_retryable_error(500));
        assert!(is_retryable_error(502));
        assert!(is_retryable_error(503));
        assert!(is_retryable_error(504));

        // Non-retryable
        assert!(!is_retryable_error(200));
        assert!(!is_retryable_error(400));
        assert!(!is_retryable_error(401));
        assert!(!is_retryable_error(403));
        assert!(!is_retryable_error(404));
    }
}

