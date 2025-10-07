import { functions, httpsCallable } from "./firebase.js";

const acceptInviteCallable = httpsCallable(functions, "acceptInvite");

export async function acceptInvite(inviteCode) {
  const result = await acceptInviteCallable({ inviteCode });
  return result.data;
}
