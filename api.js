import { functions, httpsCallable } from "./firebase.js";

const acceptInviteCallable = httpsCallable(functions, "acceptInvite");

export async function acceptInvite(inviteCode, userId) {
  const result = await acceptInviteCallable({ inviteCode, userId });
  return result.data;
}
