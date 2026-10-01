/**
 * BUG #2 (null/undefined access): getUserCity reads user.address.city
 * without checking that address exists. Users who signed up before the
 * address field was added (or who skipped it) crash the profile page.
 */
export function getUserCity(user) {
  return user.address.city;
}
