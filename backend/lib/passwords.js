import bcrypt from 'bcryptjs';

const COST = 10;
// Compared against when a username doesn't exist so login timing doesn't reveal it.
const DUMMY_HASH = bcrypt.hashSync('smartrail-dummy-password', COST);

export const isHashed = (value) => typeof value === 'string' && /^\$2[aby]\$/.test(value);

export const hashPassword = (plain) => bcrypt.hash(plain, COST);

export const verifyPassword = async (plain, hash) => {
  const ok = await bcrypt.compare(String(plain ?? ''), hash || DUMMY_HASH);
  return Boolean(hash) && ok;
};

export const PASSWORD_RULE = 'Password must be at least 8 characters and include a letter and a number.';
export const USERNAME_RULE = 'Username must be 3-30 characters: letters, numbers, dot, dash or underscore.';

export const validatePassword = (password) =>
  typeof password === 'string' &&
  password.length >= 8 &&
  password.length <= 72 &&
  /[A-Za-z]/.test(password) &&
  /\d/.test(password);

export const normalizeUsername = (username) => (typeof username === 'string' ? username.trim() : '');

export const validateUsername = (username) => /^[A-Za-z0-9_.-]{3,30}$/.test(username);
