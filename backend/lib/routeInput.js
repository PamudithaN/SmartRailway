const STATUSES = ['active', 'inactive'];

// Normalises and validates a route body. With `partial`, absent fields are left out of the result.
// Returns { error } or { values }.
export const parseRouteInput = (body, { partial = false } = {}) => {
  const values = {};

  if (body.name !== undefined || !partial) {
    const name = String(body.name ?? '').trim();
    if (!name) return { error: 'Route name is required.' };
    if (name.length > 80) return { error: 'Route name is too long.' };
    values.name = name;
  }

  if (body.fare !== undefined || !partial) {
    const fare = Number(body.fare);
    if (body.fare === '' || body.fare === null || !Number.isFinite(fare) || fare < 0) {
      return { error: 'Fare must be a number of 0 or more.' };
    }
    values.fare = Math.round(fare * 100) / 100;
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return { error: 'Status must be active or inactive.' };
    values.status = body.status;
  }

  if (body.stations !== undefined || !partial) {
    if (!Array.isArray(body.stations)) return { error: 'Stations must be a list.' };
    const names = body.stations.map((s) => String(s ?? '').trim().replace(/\s+/g, ' '));
    if (names.some((n) => !n || n.length > 80)) return { error: 'Station names cannot be blank.' };
    if (names.length < 2) return { error: 'A Route needs at least two Stations.' };
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) {
      return { error: 'A Station can only appear once on a Route.' };
    }
    values.stations = names;
  }

  return { values };
};
