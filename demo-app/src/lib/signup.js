/**
 * BUG #7 (missing input validation): createUser accepts any string as an
 * email, including empty or malformed ones, so a client bug upstream can
 * create accounts with "" as the email, which breaks every later lookup
 * that assumes a non-empty address.
 */
const users = new Map();
let nextId = 1;

export function createUser({ name, email }) {
  const id = nextId++;
  const user = { id, name, email };
  users.set(id, user);
  return user;
}

export function getUser(id) {
  const user = users.get(id);
  if (!user) throw new RangeError(`no such user: ${id}`);
  return user;
}

export function _resetUsersForTests() {
  users.clear();
  nextId = 1;
}
