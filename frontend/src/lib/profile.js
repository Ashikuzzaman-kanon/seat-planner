import api from "@/lib/api";

/**
 * The account holder's own travel details.
 *
 * Separate from the ticket passengers on purpose: a booking may carry four
 * different people, and this is only who the account belongs to. It exists so
 * the common case — buying for yourself — is a confirmation rather than a
 * re-typing of a seventeen-digit number.
 */

export async function fetchProfile() {
  const { data } = await api.get("/auth/profile");
  return data.profile;
}

export async function saveProfile({ fullName, nid, dateOfBirth }) {
  const { data } = await api.put("/auth/profile", { fullName, nid, dateOfBirth });
  return data.profile;
}

/** Shaped as the booking form wants a passenger, for pre-filling the first seat. */
export const asPassenger = (profile) =>
  profile?.hasTravelProfile
    ? { name: profile.fullName, nid: profile.nid, dob: profile.dateOfBirth }
    : null;
