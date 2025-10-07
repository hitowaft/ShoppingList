/**
 * Cloud Functions entry point for the shopping list backend.
 */

const {onCall} = require("firebase-functions/v2/https");
const {HttpsError} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/**
 * Callable function to accept a shared list invite.
 * Expects { inviteCode: string } in the data payload and uses the caller's
 * Firebase Auth context to attach the current user to the target list.
 */
exports.acceptInvite = onCall({cors: true}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "ログインした状態でアクセスしてください。");
  }

  const inviteCode = request.data?.inviteCode;
  if (!inviteCode || typeof inviteCode !== "string") {
    throw new HttpsError("invalid-argument", "有効な招待コードを指定してください。");
  }

  const inviteRef = db.collection("invites").doc(inviteCode);
  const inviteSnap = await inviteRef.get();

  if (!inviteSnap.exists) {
    throw new HttpsError("not-found", "招待コードが見つかりませんでした。");
  }

  const inviteData = inviteSnap.data();
  const {listId, status, expiresAt} = inviteData;

  if (!listId) {
    throw new HttpsError("failed-precondition", "招待先のリスト情報が無効です。");
  }

  if (status && status !== "active") {
    throw new HttpsError("failed-precondition", "この招待リンクは使用できません。");
  }

  if (expiresAt && expiresAt.toDate && expiresAt.toDate() < new Date()) {
    await inviteRef.update({status: "expired", expiredAt: admin.firestore.FieldValue.serverTimestamp()});
    throw new HttpsError("deadline-exceeded", "招待リンクの有効期限が切れています。");
  }

  const listRef = db.collection("lists").doc(listId);

  const result = await db.runTransaction(async (transaction) => {
    const [listSnap] = await Promise.all([
      transaction.get(listRef),
    ]);

    if (!listSnap.exists) {
      throw new HttpsError("not-found", "招待先のリストが存在しません。");
    }

    const listData = listSnap.data();
    const members = Array.isArray(listData.members) ? listData.members : [];

    const alreadyMember = members.includes(uid);
    if (!alreadyMember) {
      members.push(uid);
      transaction.update(listRef, {
        members,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    transaction.update(inviteRef, {
      status: "used",
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
      usedBy: uid,
    });

    return {listId, alreadyMember};
  });

  logger.info("Invite accepted", {inviteCode, uid, listId: result.listId});

  return {
    listId: result.listId,
    alreadyMember: result.alreadyMember,
  };
});
