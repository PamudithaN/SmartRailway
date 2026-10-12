// Passenger contact details collected at registration (and kept for a future self-service password reset).
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

const FIELDS = [
  {
    key: 'fullName',
    label: 'Full name',
    normalize: (v) => v.replace(/\s+/g, ' '),
    valid: (v) => v.length >= 2 && v.length <= 80,
    rule: 'Full name must be 2-80 characters.',
  },
  {
    key: 'phone',
    label: 'Phone number',
    // +94771234567 / 94771234567 / 0771234567 are all stored as 0771234567.
    normalize: (v) => {
      const compact = v.replace(/[\s-]/g, '');
      return compact.replace(/^(\+94|94)/, '0');
    },
    valid: (v) => /^0\d{9}$/.test(v),
    rule: 'Phone number must be a valid Sri Lankan number, e.g. 0771234567.',
  },
  {
    key: 'nic',
    label: 'NIC',
    normalize: (v) => v.replace(/\s+/g, '').toUpperCase(),
    valid: (v) => /^(\d{9}[VX]|\d{12})$/.test(v),
    rule: 'NIC must be 9 digits followed by V or X, or 12 digits.',
  },
  {
    key: 'email',
    label: 'Email',
    normalize: (v) => v.toLowerCase(),
    valid: (v) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    rule: 'Email address is not valid.',
  },
];

// Returns { error } or { values } holding only the fields that were provided.
// With `required`, every field must be present (Passenger self-registration).
export const parseProfile = (body, { required = false } = {}) => {
  const values = {};
  for (const f of FIELDS) {
    const raw = clean(body[f.key]);
    if (!raw) {
      if (required) return { error: `${f.label} is required.` };
      continue;
    }
    const value = f.normalize(raw);
    if (!f.valid(value)) return { error: f.rule };
    values[f.key] = value;
  }
  return { values };
};

// Maps a unique-violation from Postgres to a friendly message, or null if it isn't one.
export const conflictMessage = (err) => {
  if (err?.code !== '23505') return null;
  if (/email/.test(err.constraint || '')) return 'Email already registered';
  if (/nic/.test(err.constraint || '')) return 'NIC already registered';
  return 'Username already taken';
};
