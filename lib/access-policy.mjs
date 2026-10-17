// Centralize login precedence so code-issued grants cannot be skipped by an
// older whitelist row. Environment administrators remain explicit trusted bypasses.
export function accessForOAuth({ isBlocked = false, isAdmin, isWhitelisted, hasActiveCode, bootstrapAllowed }) {
  if (isBlocked) return "denied";
  if (hasActiveCode) return "pending";
  if (isAdmin || isWhitelisted) return "authorized";
  if (bootstrapAllowed) return "bootstrap";
  return "denied";
}

export function accessForPendingSession({ isBlocked = false, isAdmin, isWhitelisted, hasActiveCode }) {
  if (isBlocked) return "denied";
  if (hasActiveCode) return "pending";
  if (isWhitelisted) return "authorized";
  if (isAdmin) return "authorized";
  return "denied";
}
