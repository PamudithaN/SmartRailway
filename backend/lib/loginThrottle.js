// In-memory, per-process login throttle keyed by lower-cased username.
// Unknown usernames are counted too, so a block never reveals whether an account exists.
const MAX_FAILURES = 5;
const BLOCK_MS = 15 * 60 * 1000;

const attempts = new Map();

const keyOf = (username) => String(username).toLowerCase();

// Returns remaining block time in ms, or 0 when not blocked.
export const blockedFor = (username) => {
  const entry = attempts.get(keyOf(username));
  if (!entry || !entry.blockedUntil) return 0;
  const remaining = entry.blockedUntil - Date.now();
  if (remaining <= 0) {
    attempts.delete(keyOf(username));
    return 0;
  }
  return remaining;
};

export const recordFailure = (username) => {
  const key = keyOf(username);
  const entry = attempts.get(key) || { failures: 0, blockedUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= MAX_FAILURES) entry.blockedUntil = Date.now() + BLOCK_MS;
  attempts.set(key, entry);
};

export const clearFailures = (username) => attempts.delete(keyOf(username));
