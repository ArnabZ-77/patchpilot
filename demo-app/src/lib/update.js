import { getUser } from "./signup.js";

/**
 * BUG #8 (missing input validation): updateEmail writes whatever is passed
 * without checking it looks like an email, so a client that forgets to
 * read the form field sends `undefined` as a string and the user's email
 * becomes the literal text "undefined".
 */
export function updateEmail(id, newEmail) {
  const user = getUser(id);
  user.email = String(newEmail);
  return user;
}
