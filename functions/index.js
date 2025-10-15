/**
 * Cloud Functions entry point for the shopping list backend.
 */

const crypto = require("crypto");
const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const express = require("express");
const Alexa = require("ask-sdk-core");

admin.initializeApp();
const db = admin.firestore();

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {error: error?.stack || error});
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", {reason: reason instanceof Error ? reason.stack : reason});
});

const defaultListId = process.env.ALEXA_DEFAULT_LIST_ID || null;
const configuredSkillId = process.env.ALEXA_SKILL_ID || null;
const allowedClientId = process.env.ALEXA_CLIENT_ID || null;
const allowedClientSecret = process.env.ALEXA_CLIENT_SECRET || null;

const LINK_CODE_TTL_MINUTES = Number(process.env.ALEXA_LINK_CODE_TTL_MINUTES || 10);
const AUTH_CODE_TTL_MINUTES = Number(process.env.ALEXA_AUTH_CODE_TTL_MINUTES || 5);
const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.ALEXA_ACCESS_TOKEN_TTL_SECONDS || 3600);
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.ALEXA_REFRESH_TOKEN_TTL_DAYS || 30);

const requiredAuthParams = ["response_type", "client_id", "redirect_uri", "state"];

const linkCodeCollection = db.collection("alexaLinkCodes");
const authCodeCollection = db.collection("alexaAuthCodes");
const refreshTokenCollection = db.collection("alexaRefreshTokens");
const deviceRecoveryCollection = db.collection("deviceRecoveryKeys");

const MINUTE_IN_MS = 60 * 1000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const CLEANUP_GRACE_MINUTES = Math.max(0, Number(process.env.CLEANUP_GRACE_MINUTES || 5));
const INVITE_RETENTION_DAYS = Math.max(0, Number(process.env.INVITE_RETENTION_DAYS || 30));
const MAINTENANCE_TOKEN = process.env.MAINTENANCE_TOKEN || null;
const INVITE_CLEANUP_BATCH_SIZE = 200;

const parseMemberProfiles = (value) => {
  const result = {};
  if (!value || typeof value !== "object") {
    return result;
  }
  for (const [memberId, profile] of Object.entries(value)) {
    if (typeof memberId !== "string") {
      continue;
    }
    const displayName = typeof profile?.displayName === "string" ? profile.displayName.trim() : "";
    if (displayName) {
      result[memberId] = displayName;
    }
  }
  return result;
};

const buildMemberProfilesStorageMap = (profileNames) => {
  const storage = {};
  if (!profileNames || typeof profileNames !== "object") {
    return storage;
  }
  for (const [memberId, displayName] of Object.entries(profileNames)) {
    if (typeof memberId !== "string") {
      continue;
    }
    if (typeof displayName === "string" && displayName.trim().length > 0) {
      storage[memberId] = {displayName: displayName.trim()};
    }
  }
  return storage;
};

const filterProfilesByMembers = (profileNames, members) => {
  const allowed = new Set(Array.isArray(members) ? members : []);
  const filtered = {};
  if (!profileNames || typeof profileNames !== "object") {
    return filtered;
  }
  for (const [memberId, displayName] of Object.entries(profileNames)) {
    if (allowed.has(memberId) && typeof displayName === "string" && displayName.trim().length > 0) {
      filtered[memberId] = displayName.trim();
    }
  }
  return filtered;
};

const toMillis = (firestoreTimestamp) => {
  if (!firestoreTimestamp) {
    return null;
  }
  if (typeof firestoreTimestamp.toMillis === "function") {
    return firestoreTimestamp.toMillis();
  }
  if (typeof firestoreTimestamp.toDate === "function") {
    const date = firestoreTimestamp.toDate();
    return date instanceof Date ? date.getTime() : null;
  }
  if (firestoreTimestamp instanceof Date) {
    return firestoreTimestamp.getTime();
  }
  return null;
};

const deleteExpiredDocuments = async ({collectionRef, timestampField, beforeTimestamp, batchSize = 200, logLabel}) => {
  if (!beforeTimestamp) {
    return 0;
  }
  let deleted = 0;
  let hasMore = true;
  while (hasMore) {
    let query = collectionRef.orderBy(timestampField);
    query = query.endBefore(beforeTimestamp);
    const snapshot = await query.limit(batchSize).get();
    if (snapshot.empty) {
      hasMore = false;
      break;
    }
    const batch = db.batch();
    snapshot.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });
    await batch.commit();
    deleted += snapshot.size;
    hasMore = snapshot.size === batchSize;
  }
  if (deleted > 0 && logLabel) {
    logger.info("Deleted expired documents", {collection: logLabel, count: deleted});
  }
  return deleted;
};

const cleanupInvites = async ({nowTimestamp, deleteBeforeTimestamp}) => {
  const invitesRef = db.collection("invites");
  const deleteBeforeMillis = deleteBeforeTimestamp ? deleteBeforeTimestamp.toMillis() : null;

  let cursor = null;
  let markedExpired = 0;
  let deleted = 0;
  let more = true;

  while (more) {
    let query = invitesRef.orderBy("expiresAt");
    if (cursor) {
      query = query.startAfter(cursor);
    }
    query = query.endBefore(nowTimestamp);
    const snapshot = await query.limit(INVITE_CLEANUP_BATCH_SIZE).get();
    if (snapshot.empty) {
      more = false;
      break;
    }

    const batch = db.batch();
    let operations = 0;

    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const status = typeof data.status === "string" ? data.status : "active";
      const expiresAtMillis = toMillis(data.expiresAt);

      if (deleteBeforeMillis !== null && (expiresAtMillis === null || expiresAtMillis < deleteBeforeMillis)) {
        batch.delete(docSnap.ref);
        deleted += 1;
        operations += 1;
        return;
      }

      if (status === "active") {
        batch.update(docSnap.ref, {
          status: "expired",
          expiredAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        markedExpired += 1;
        operations += 1;
      }
    });

    if (operations > 0) {
      await batch.commit();
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];
    more = snapshot.size === INVITE_CLEANUP_BATCH_SIZE;
  }

  if (deleteBeforeTimestamp) {
    let hasMore = true;
    let deletionCursor = null;
    while (hasMore) {
      let query = invitesRef.orderBy("expiresAt");
      if (deletionCursor) {
        query = query.startAfter(deletionCursor);
      }
      query = query.endBefore(deleteBeforeTimestamp);
      const snapshot = await query.limit(INVITE_CLEANUP_BATCH_SIZE).get();
      if (snapshot.empty) {
        hasMore = false;
        break;
      }
      const batch = db.batch();
      let operations = 0;
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const status = typeof data.status === "string" ? data.status : "active";
        if (status !== "active") {
          batch.delete(docSnap.ref);
          deleted += 1;
          operations += 1;
        }
      });
      if (operations > 0) {
        await batch.commit();
      }
      deletionCursor = snapshot.docs[snapshot.docs.length - 1];
      hasMore = snapshot.size === INVITE_CLEANUP_BATCH_SIZE;
    }
  }

  if (markedExpired > 0 || deleted > 0) {
    logger.info("Invite cleanup summary", {markedExpired, deleted});
  }

  return {markedExpired, deleted};
};

const performCleanup = async () => {
  const nowMillis = Date.now();
  const cleanupThresholdTimestamp = admin.firestore.Timestamp.fromMillis(
    Math.max(0, nowMillis - CLEANUP_GRACE_MINUTES * MINUTE_IN_MS),
  );
  const inviteRetentionMillis = INVITE_RETENTION_DAYS * DAY_IN_MS;
  const inviteDeleteBeforeTimestamp = INVITE_RETENTION_DAYS > 0
    ? admin.firestore.Timestamp.fromMillis(Math.max(0, nowMillis - inviteRetentionMillis))
    : null;

  const [linkCodesDeleted, authCodesDeleted, refreshTokensDeleted] = await Promise.all([
    deleteExpiredDocuments({
      collectionRef: linkCodeCollection,
      timestampField: "expiresAt",
      beforeTimestamp: cleanupThresholdTimestamp,
      logLabel: "alexaLinkCodes",
    }),
    deleteExpiredDocuments({
      collectionRef: authCodeCollection,
      timestampField: "expiresAt",
      beforeTimestamp: cleanupThresholdTimestamp,
      logLabel: "alexaAuthCodes",
    }),
    deleteExpiredDocuments({
      collectionRef: refreshTokenCollection,
      timestampField: "expiresAt",
      beforeTimestamp: cleanupThresholdTimestamp,
      logLabel: "alexaRefreshTokens",
    }),
  ]);

  const inviteResult = await cleanupInvites({
    nowTimestamp: admin.firestore.Timestamp.fromMillis(nowMillis),
    deleteBeforeTimestamp: inviteDeleteBeforeTimestamp,
  });

  const summary = {
    linkCodesDeleted,
    authCodesDeleted,
    refreshTokensDeleted,
    invitesMarkedExpired: inviteResult.markedExpired,
    invitesDeleted: inviteResult.deleted,
  };

  logger.info("Cleanup cycle finished", summary);
  return summary;
};

exports.cleanupStaleData = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "Asia/Tokyo",
  },
  async () => {
    try {
      await performCleanup();
    } catch (error) {
      logger.error("Scheduled cleanup failed", {error: error?.stack || error});
      throw error;
    }
  },
);

exports.runMaintenanceCleanup = onCall({}, async (request) => {
  if (!MAINTENANCE_TOKEN) {
    throw new HttpsError("failed-precondition", "Maintenance token is not configured.");
  }
  const providedToken = request.data?.token;
  if (providedToken !== MAINTENANCE_TOKEN) {
    throw new HttpsError("permission-denied", "Invalid maintenance token.");
  }
  try {
    const summary = await performCleanup();
    return summary;
  } catch (error) {
    logger.error("Manual cleanup failed", {error: error?.stack || error});
    throw new HttpsError("internal", "Cleanup failed.");
  }
});

exports.registerDeviceRecovery = onCall({cors: true}, async (request) => {
  const listId = typeof request.data?.listId === "string" ? request.data.listId.trim() : "";
  const userId = typeof request.data?.userId === "string" ? request.data.userId.trim() : "";
  const currentKey = typeof request.data?.recoveryKey === "string" ? request.data.recoveryKey.trim() : "";

  if (!isNonEmptyString(listId) || !isNonEmptyString(userId)) {
    throw new HttpsError("invalid-argument", "有効なリストIDとユーザーIDを指定してください。");
  }

  const listRef = db.collection("lists").doc(listId);
  const listSnap = await listRef.get();
  if (!listSnap.exists) {
    throw new HttpsError("not-found", "指定されたリストが見つかりませんでした。");
  }

  const listData = listSnap.data() || {};
  const members = Array.isArray(listData.members) ? listData.members : [];
  if (!members.includes(userId)) {
    throw new HttpsError("permission-denied", "このリストに対する権限がありません。");
  }

  let keyToUse = currentKey && currentKey.length > 0 ? currentKey : null;
  let keyHash = null;
  let recoveryRef = null;
  let recoverySnap = null;

  if (keyToUse) {
    try {
      keyHash = hashRecoveryKey(keyToUse);
      recoveryRef = deviceRecoveryCollection.doc(keyHash);
      recoverySnap = await recoveryRef.get();
      if (!recoverySnap.exists || recoverySnap.data()?.listId !== listId || recoverySnap.data()?.disabled === true) {
        keyToUse = null;
        recoverySnap = null;
        recoveryRef = null;
      }
    } catch (error) {
      logger.warn("Failed to reuse recovery key", {error: error?.message || error});
      keyToUse = null;
      recoverySnap = null;
      recoveryRef = null;
    }
  }

  if (!keyToUse) {
    let created = false;
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      const candidate = createRecoveryKey();
      const candidateHash = hashRecoveryKey(candidate);
      const candidateRef = deviceRecoveryCollection.doc(candidateHash);
      const candidateSnap = await candidateRef.get();
      if (!candidateSnap.exists) {
        keyToUse = candidate;
        keyHash = candidateHash;
        recoveryRef = candidateRef;
        recoverySnap = candidateSnap;
        created = true;
      }
    }

    if (!created || !keyToUse || !recoveryRef) {
      throw new HttpsError("resource-exhausted", "復元コードを生成できませんでした。時間をおいて再試行してください。");
    }
  } else if (!keyHash || !recoveryRef) {
    keyHash = hashRecoveryKey(keyToUse);
    recoveryRef = deviceRecoveryCollection.doc(keyHash);
    recoverySnap = await recoveryRef.get();
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload = {
    listId,
    lastRegisteredBy: userId,
    lastRegisteredAt: now,
    disabled: false,
  };
  if (!recoverySnap || !recoverySnap.exists) {
    payload.createdAt = now;
  }

  await recoveryRef.set(payload, {merge: true});

  return {
    listId,
    recoveryKey: keyToUse,
  };
});

exports.claimDeviceRecovery = onCall({cors: true}, async (request) => {
  const recoveryKey = typeof request.data?.recoveryKey === "string" ? request.data.recoveryKey.trim() : "";
  const userId = typeof request.data?.userId === "string" ? request.data.userId.trim() : "";

  if (!isNonEmptyString(recoveryKey) || !isNonEmptyString(userId)) {
    throw new HttpsError("invalid-argument", "復元コードとユーザーIDを指定してください。");
  }

  const keyHash = hashRecoveryKey(recoveryKey);
  const recoveryRef = deviceRecoveryCollection.doc(keyHash);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const recoverySnap = await transaction.get(recoveryRef);
      if (!recoverySnap.exists) {
        const error = new Error("Recovery key not found.");
        error.code = "not-found";
        throw error;
      }
      const recoveryData = recoverySnap.data() || {};
      if (recoveryData.disabled) {
        const error = new Error("Recovery key disabled.");
        error.code = "failed-precondition";
        throw error;
      }
      const listId = typeof recoveryData.listId === "string" ? recoveryData.listId : null;
      if (!listId) {
        const error = new Error("Recovery key missing list reference.");
        error.code = "failed-precondition";
        throw error;
      }

      const listRef = db.collection("lists").doc(listId);
      const listSnap = await transaction.get(listRef);
      if (!listSnap.exists) {
        transaction.set(recoveryRef, {
          disabled: true,
          disabledAt: admin.firestore.FieldValue.serverTimestamp(),
          disabledReason: "list-not-found",
        }, {merge: true});
        const error = new Error("Target list not found.");
        error.code = "not-found";
        throw error;
      }

      const listData = listSnap.data() || {};
      const members = Array.isArray(listData.members) ? listData.members.slice() : [];
      const alreadyMember = members.includes(userId);
      if (!alreadyMember) {
        members.push(userId);
        transaction.update(listRef, {
          members,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      transaction.set(recoveryRef, {
        lastClaimedBy: userId,
        lastClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      return {
        listId,
        listName: typeof listData.name === "string" && listData.name.length > 0 ? listData.name : "共有買い物リスト",
        alreadyMember,
      };
    });

    return result;
  } catch (error) {
    if (error?.code && typeof error.code === "string") {
      throw new HttpsError(error.code, error.message || "復元に失敗しました。");
    }
    logger.error("Device recovery claim failed", {error: error?.stack || error});
    throw new HttpsError("internal", "復元に失敗しました。");
  }
});

exports.trimListMembers = onCall({cors: true}, async (request) => {
  const listId = typeof request.data?.listId === "string" ? request.data.listId.trim() : "";
  const userId = typeof request.data?.userId === "string" ? request.data.userId.trim() : "";
  const keepMembersInput = Array.isArray(request.data?.keepMembers) ? request.data.keepMembers : [];

  if (!isNonEmptyString(listId) || !isNonEmptyString(userId)) {
    throw new HttpsError("invalid-argument", "有効なリストIDとユーザーIDを指定してください。");
  }

  const normalizedKeepMembers = Array.from(new Set(keepMembersInput
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())));

  if (!normalizedKeepMembers.includes(userId)) {
    normalizedKeepMembers.push(userId);
  }

  if (normalizedKeepMembers.length === 0) {
    throw new HttpsError("failed-precondition", "少なくとも1件の端末を残してください。");
  }

  const listRef = db.collection("lists").doc(listId);

  const result = await db.runTransaction(async (transaction) => {
    const listSnap = await transaction.get(listRef);
    if (!listSnap.exists) {
      throw new HttpsError("not-found", "指定されたリストが見つかりませんでした。");
    }

    const listData = listSnap.data() || {};
    const members = Array.isArray(listData.members) ? listData.members : [];

    if (!members.includes(userId)) {
      throw new HttpsError("permission-denied", "このリストに対する権限がありません。");
    }

    const currentMemberSet = new Set(members);
    const keepSet = new Set(normalizedKeepMembers.filter((memberId) => currentMemberSet.has(memberId)));

    if (keepSet.size === 0) {
      throw new HttpsError("failed-precondition", "少なくとも1件の端末を残してください。");
    }

    const updatedMembers = members.filter((memberId) => keepSet.has(memberId));
    const currentProfiles = parseMemberProfiles(listData.memberProfiles);
    const filteredProfiles = filterProfilesByMembers(currentProfiles, updatedMembers);
    const storageProfiles = buildMemberProfilesStorageMap(filteredProfiles);

    transaction.update(listRef, {
      members: updatedMembers,
      memberProfiles: storageProfiles,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      members: updatedMembers,
      removedCount: members.length - updatedMembers.length,
      memberProfiles: filteredProfiles,
    };
  });

  logger.info("List members trimmed", {
    listId,
    userId,
    removedCount: result.removedCount,
  });

  return result;
});

exports.updateDeviceProfile = onCall({cors: true}, async (request) => {
  const listId = typeof request.data?.listId === "string" ? request.data.listId.trim() : "";
  const userId = typeof request.data?.userId === "string" ? request.data.userId.trim() : "";
  const memberId = typeof request.data?.memberId === "string" ? request.data.memberId.trim() : "";
  const displayNameInput = typeof request.data?.displayName === "string" ? request.data.displayName : "";

  if (!isNonEmptyString(listId) || !isNonEmptyString(userId) || !isNonEmptyString(memberId)) {
    throw new HttpsError("invalid-argument", "有効なリストID、利用者ID、端末IDを指定してください。");
  }

  const trimmedDisplayName = displayNameInput.trim();
  if (trimmedDisplayName.length > 32) {
    throw new HttpsError("invalid-argument", "端末名は32文字以内で指定してください。");
  }

  const listRef = db.collection("lists").doc(listId);

  const sanitizedProfiles = await db.runTransaction(async (transaction) => {
    const listSnap = await transaction.get(listRef);
    if (!listSnap.exists) {
      throw new HttpsError("not-found", "指定されたリストが見つかりませんでした。");
    }

    const listData = listSnap.data() || {};
    const members = Array.isArray(listData.members) ? listData.members : [];

    if (!members.includes(userId)) {
      throw new HttpsError("permission-denied", "このリストに対する権限がありません。");
    }
    if (!members.includes(memberId)) {
      throw new HttpsError("not-found", "指定された端末が見つかりませんでした。");
    }

    const currentProfiles = parseMemberProfiles(listData.memberProfiles);

    if (trimmedDisplayName) {
      currentProfiles[memberId] = trimmedDisplayName;
    } else {
      delete currentProfiles[memberId];
    }

    const storageProfiles = buildMemberProfilesStorageMap(currentProfiles);

    transaction.update(listRef, {
      memberProfiles: storageProfiles,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return currentProfiles;
  });

  logger.info("List member profile updated", {
    listId,
    memberId,
    userId,
  });

  return {
    memberProfiles: sanitizedProfiles,
  };
});

const isClientAllowed = (clientId, clientSecret, {enforceSecret = false} = {}) => {
  if (allowedClientId && clientId !== allowedClientId) {
    return false;
  }
  if (enforceSecret && allowedClientSecret && clientSecret !== allowedClientSecret) {
    return false;
  }
  return true;
};

const generateRandomCode = (length) => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i += 1) {
    const randomIndex = crypto.randomInt(0, alphabet.length);
    result += alphabet[randomIndex];
  }
  return result;
};

const generateRandomToken = (byteLength = 32) => crypto.randomBytes(byteLength).toString("hex");

const createRecoveryKey = () => crypto.randomBytes(32).toString("hex");

const hashRecoveryKey = (value) => {
  if (!value || typeof value !== "string") {
    throw new Error("Recovery key must be a non-empty string");
  }
  return crypto.createHash("sha256").update(value).digest("hex");
};

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const htmlEscape = (value) => String(value || "").replace(/[&<>"]/g, (char) => {
  switch (char) {
  case "&":
    return "&amp;";
  case "<":
    return "&lt;";
  case ">":
    return "&gt;";
  case "\"":
    return "&quot;";
  default:
    return char;
  }
});

const buildAuthorizePage = ({clientId, redirectUri, state, errorMessage}) => {
  const errorBlock = errorMessage ? `<p class="error">${htmlEscape(errorMessage)}</p>` : "";
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Alexa連携</title>
  <style>
    body { font-family: sans-serif; margin: 2rem; line-height: 1.6; }
    form { margin-top: 1.5rem; }
    label { display: block; margin-bottom: 0.5rem; font-weight: 600; }
    input[type="text"] { padding: 0.6rem; width: 100%; max-width: 320px; font-size: 1rem; }
    button { margin-top: 1rem; padding: 0.6rem 1.2rem; font-size: 1rem; }
    .error { color: #b00020; font-weight: 600; }
    .meta { font-size: 0.85rem; color: #555; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>Alexaと買い物リストをリンク</h1>
  <p>Webアプリで発行した6桁のリンクコードを入力してください。</p>
  ${errorBlock}
  <form method="POST">
    <label for="link_code">リンクコード</label>
    <input id="link_code" name="link_code" type="text" required pattern="[A-Za-z0-9]{6}" maxlength="6" autocomplete="one-time-code">
    <input type="hidden" name="client_id" value="${htmlEscape(clientId)}">
    <input type="hidden" name="redirect_uri" value="${htmlEscape(redirectUri)}">
    <input type="hidden" name="state" value="${htmlEscape(state)}">
    <input type="hidden" name="response_type" value="code">
    <button type="submit">リンクする</button>
  </form>
  <p class="meta">Alexaアプリに戻るとリンクが完了します。</p>
</body>
</html>`;
};

const parseAccessTokenPayload = (token) => {
  if (!token || typeof token !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(token);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (parsed.exp && typeof parsed.exp === "number" && parsed.exp < Date.now()) {
      logger.warn("Access token expired", {exp: parsed.exp});
      return null;
    }
    return parsed;
  } catch (error) {
    logger.warn("Failed to parse Alexa access token", {error: error.message});
    return null;
  }
};

const resolveListId = (handlerInput) => {
  const attributesManager = handlerInput.attributesManager;
  const sessionAttributes = attributesManager.getSessionAttributes() || {};

  const token = handlerInput.requestEnvelope?.context?.System?.user?.accessToken;
  const tokenPayload = parseAccessTokenPayload(token);
  if (tokenPayload?.listId && typeof tokenPayload.listId === "string") {
    return tokenPayload.listId;
  }

  if (sessionAttributes.listId) {
    return sessionAttributes.listId;
  }

  if (defaultListId) {
    sessionAttributes.listId = defaultListId;
    attributesManager.setSessionAttributes(sessionAttributes);
    return defaultListId;
  }

  return null;
};

const addItemToFirestore = async (listId, itemName, userId) => {
  const trimmedName = itemName.trim();
  if (!trimmedName) {
    throw new Error("Item name is empty");
  }

  const listRef = db.collection("lists").doc(listId);
  const listSnap = await listRef.get();
  if (!listSnap.exists) {
    throw new Error("List not found");
  }

  const listData = listSnap.data();
  if (userId) {
    const members = Array.isArray(listData?.members) ? listData.members : [];
    if (!members.includes(userId)) {
      throw new Error("User is not a member of the list");
    }
  }

  const docRef = await listRef.collection("items").add({
    name: trimmedName,
    completed: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: userId || null,
    source: "alexa"
  });
  logger.info("Alexa item added", {listId, itemId: docRef.id, userId});
  return docRef.id;
};

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "LaunchRequest";
  },
  handle(handlerInput) {
    logger.info("LaunchRequest reached handler");
    return handlerInput.responseBuilder
      .speak("買い物リストへようこそ。アイテムを追加しますか？")
      .reprompt("追加しますか？")
      .getResponse();
  }
};

const AddItemIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "IntentRequest" &&
      handlerInput.requestEnvelope.request.intent.name === "addItem";
  },
  async handle(handlerInput) {
    const rawItemName = Alexa.getSlotValue(handlerInput.requestEnvelope, "shoppingItem");
    const itemName = rawItemName ? rawItemName.trim() : "";

    if (!itemName) {
      return handlerInput.responseBuilder
        .speak("追加したいアイテムをもう一度教えてください。")
        .reprompt("何を買い物リストに加えますか？")
        .getResponse();
    }

    const listId = resolveListId(handlerInput);
    const tokenPayload = parseAccessTokenPayload(handlerInput.requestEnvelope?.context?.System?.user?.accessToken);
    const linkedUid = tokenPayload?.uid || null;
    if (!listId) {
      return handlerInput.responseBuilder
        .speak("買い物リストがまだリンクされていません。Alexaアプリでアカウントリンクを設定してください。")
        .withShouldEndSession(true)
        .getResponse();
    }
    if (!linkedUid) {
      return handlerInput.responseBuilder
        .speak("買い物リストを利用するには、Alexaアプリでアカウントリンクを完了してください。")
        .withLinkAccountCard()
        .getResponse();
    }

    try {
      await addItemToFirestore(listId, itemName, linkedUid);
      const speechText = `${itemName} をリストに追加しました。`;
      return handlerInput.responseBuilder
        .speak(speechText)
        .withSimpleCard("買い物リスト", speechText)
        .withShouldEndSession(true)
        .getResponse();
    } catch (error) {
      logger.error("Failed to add item from Alexa", {error: error.message, listId, uid: linkedUid});
      return handlerInput.responseBuilder
        .speak("ごめんなさい。アイテムの追加に失敗しました。しばらくしてからもう一度お試しください。")
        .getResponse();
    }
  }
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "IntentRequest" &&
      handlerInput.requestEnvelope.request.intent.name === "AMAZON.HelpIntent";
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak("例えば、牛乳を買い物リストに追加して、と話しかけてください。")
      .reprompt("どのアイテムを追加しますか？")
      .getResponse();
  }
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    if (handlerInput.requestEnvelope.request.type !== "IntentRequest") {
      return false;
    }
    const intentName = handlerInput.requestEnvelope.request.intent.name;
    return intentName === "AMAZON.CancelIntent" || intentName === "AMAZON.StopIntent";
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak("またいつでもどうぞ。")
      .withShouldEndSession(true)
      .getResponse();
  }
};

const FallbackIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "IntentRequest" &&
      handlerInput.requestEnvelope.request.intent.name === "AMAZON.FallbackIntent";
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak("すみません、買い物リストに追加したいアイテムを教えてください。")
      .reprompt("何をリストに加えますか？")
      .getResponse();
  }
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === "SessionEndedRequest";
  },
  handle(handlerInput) {
    logger.info("Alexa session ended", handlerInput.requestEnvelope.request);
    return handlerInput.responseBuilder.getResponse();
  }
};

const GlobalErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    logger.error("Alexa skill error", {
      error: error?.stack || error?.message || String(error),
    });
    return handlerInput.responseBuilder
      .speak("申し訳ありません。うまく処理できませんでした。もう一度お試しください。")
      .reprompt("追加したいアイテムを教えてください。")
      .getResponse();
  }
};

const skillBuilder = Alexa.SkillBuilders.custom();
if (configuredSkillId) {
  skillBuilder.withSkillId(configuredSkillId);
}

const alexaSkill = skillBuilder
  .addRequestHandlers(
    LaunchRequestHandler,
    AddItemIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler,
  )
  .addErrorHandlers(GlobalErrorHandler)
  .withCustomUserAgent("shopping-list/alexa")
  .create();

exports.alexaShoppingList = onRequest(async (req, res) => {
  try {
    const requestBody = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    logger.info("Alexa request received", {
      method: req.method,
      headers: req.headers,
    });
    const responseEnvelope = await alexaSkill.invoke(requestBody);
    res.status(200).json(responseEnvelope);
  } catch (error) {
    logger.error("Direct invoke error", {error: error?.stack || error});
    res.status(500).send("error");
  }
});

const alexaAuthApp = express();
alexaAuthApp.use(express.urlencoded({extended: false}));
alexaAuthApp.use(express.json());
alexaAuthApp.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  next();
});

const getRequiredAuthParams = (source) => {
  const values = {};
  for (const key of requiredAuthParams) {
    const rawValue = source[key];
    if (!rawValue) {
      return {error: `Missing parameter: ${key}`};
    }
    values[key] = String(rawValue);
  }
  if (values.response_type !== "code") {
    return {error: "Unsupported response_type"};
  }
  if (!isClientAllowed(values.client_id)) {
    return {error: "Unauthorized client"};
  }
  return {values};
};

alexaAuthApp.get("/authorize", (req, res) => {
  const {values, error} = getRequiredAuthParams(req.query || {});
  if (error) {
    res.status(400).send(error);
    return;
  }
  res.status(200).send(buildAuthorizePage({
    clientId: values.client_id,
    redirectUri: values.redirect_uri,
    state: values.state,
    errorMessage: null,
  }));
});

alexaAuthApp.post("/authorize", async (req, res) => {
  try {
    const {values, error} = getRequiredAuthParams(req.body || {});
    if (error) {
      res.status(400).send(buildAuthorizePage({
        clientId: req.body?.client_id,
        redirectUri: req.body?.redirect_uri,
        state: req.body?.state,
        errorMessage: error,
      }));
      return;
    }

    const rawCode = (req.body?.link_code || "").toString().trim().toUpperCase();
    if (!rawCode || rawCode.length !== 6) {
      res.status(400).send(buildAuthorizePage({
        clientId: values.client_id,
        redirectUri: values.redirect_uri,
        state: values.state,
        errorMessage: "リンクコードを正しく入力してください。",
      }));
      return;
    }

    const codeRef = linkCodeCollection.doc(rawCode);
    const codeSnap = await codeRef.get();
    if (!codeSnap.exists) {
      res.status(400).send(buildAuthorizePage({
        clientId: values.client_id,
        redirectUri: values.redirect_uri,
        state: values.state,
        errorMessage: "無効なリンクコードです。",
      }));
      return;
    }

    const codeData = codeSnap.data();
    if (codeData.status === "consumed") {
      res.status(400).send(buildAuthorizePage({
        clientId: values.client_id,
        redirectUri: values.redirect_uri,
        state: values.state,
        errorMessage: "このコードは既に使用されています。",
      }));
      return;
    }

    const expiresAt = codeData.expiresAt?.toDate?.();
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      await codeRef.update({
        status: "expired",
        expiredAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      res.status(400).send(buildAuthorizePage({
        clientId: values.client_id,
        redirectUri: values.redirect_uri,
        state: values.state,
        errorMessage: "コードの有効期限が切れています。",
      }));
      return;
    }

    const authCode = generateRandomToken(24);
    const authExpiresAt = new Date(Date.now() + AUTH_CODE_TTL_MINUTES * 60 * 1000);

    await Promise.all([
      authCodeCollection.doc(authCode).set({
        uid: codeData.uid,
        listId: codeData.listId,
        clientId: values.client_id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromDate(authExpiresAt),
      }),
      codeRef.update({
        status: "consumed",
        consumedAt: admin.firestore.FieldValue.serverTimestamp(),
        consumedByClientId: values.client_id,
      }),
    ]);

    const redirectUrl = new URL(values.redirect_uri);
    redirectUrl.searchParams.set("code", authCode);
    if (values.state) {
      redirectUrl.searchParams.set("state", values.state);
    }

    res.redirect(302, redirectUrl.toString());
  } catch (error) {
    logger.error("Alexa authorize endpoint failure", {error: error.message});
    res.status(500).send(buildAuthorizePage({
      clientId: req.body?.client_id,
      redirectUri: req.body?.redirect_uri,
      state: req.body?.state,
      errorMessage: "内部エラーが発生しました。しばらくしてからお試しください。",
    }));
  }
});

const buildTokenResponse = ({accessToken, refreshToken, expiresIn}) => ({
  token_type: "Bearer",
  access_token: accessToken,
  expires_in: expiresIn,
  refresh_token: refreshToken,
});

const handleAuthorizationCodeGrant = async ({code, clientId, clientSecret}) => {
  if (!code || typeof code !== "string") {
    throw new HttpsError("invalid-argument", "Missing authorization code");
  }
  if (!isClientAllowed(clientId, clientSecret, {enforceSecret: Boolean(allowedClientSecret)})) {
    throw new HttpsError("permission-denied", "Unauthorized client");
  }

  const authRef = authCodeCollection.doc(code);
  const authSnap = await authRef.get();
  if (!authSnap.exists) {
    throw new HttpsError("invalid-argument", "Authorization code not found");
  }
  const authData = authSnap.data();
  if (authData.clientId && authData.clientId !== clientId) {
    throw new HttpsError("permission-denied", "Authorization code client mismatch");
  }

  const authExpiresAt = authData.expiresAt?.toDate?.();
  if (authExpiresAt && authExpiresAt.getTime() < Date.now()) {
    await authRef.delete();
    throw new HttpsError("deadline-exceeded", "Authorization code expired");
  }
  await authRef.delete();

  const tokenPayload = {
    aud: "alexa-shopping-list",
    iss: "firebase-functions",
  };
  tokenPayload.uid = authData.uid;
  tokenPayload.listId = authData.listId;
  const accessToken = JSON.stringify({
    ...tokenPayload,
    exp: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  const refreshToken = generateRandomToken(32);
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await Promise.all([
    refreshTokenCollection.doc(refreshToken).set({
      uid: authData.uid,
      listId: authData.listId,
      clientId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(refreshExpiresAt),
      lastRefreshedAt: admin.firestore.FieldValue.serverTimestamp(),
    }),
  ]);

  return buildTokenResponse({
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
};

const handleRefreshTokenGrant = async ({refreshToken, clientId, clientSecret}) => {
  if (!refreshToken || typeof refreshToken !== "string") {
    throw new HttpsError("invalid-argument", "Missing refresh token");
  }
  if (!isClientAllowed(clientId, clientSecret, {enforceSecret: Boolean(allowedClientSecret)})) {
    throw new HttpsError("permission-denied", "Unauthorized client");
  }

  const tokenRef = refreshTokenCollection.doc(refreshToken);
  const tokenSnap = await tokenRef.get();
  if (!tokenSnap.exists) {
    throw new HttpsError("invalid-argument", "Refresh token not found");
  }
  const tokenData = tokenSnap.data();
  if (tokenData.clientId && tokenData.clientId !== clientId) {
    throw new HttpsError("permission-denied", "Refresh token client mismatch");
  }
  const expiresAt = tokenData.expiresAt?.toDate?.();
  if (expiresAt && expiresAt.getTime() < Date.now()) {
    await tokenRef.delete();
    throw new HttpsError("deadline-exceeded", "Refresh token expired");
  }

  const accessToken = JSON.stringify({
    uid: tokenData.uid,
    listId: tokenData.listId,
    aud: "alexa-shopping-list",
    iss: "firebase-functions",
    exp: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
  });

  await tokenRef.update({
    lastRefreshedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return buildTokenResponse({
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
};

alexaAuthApp.post("/token", async (req, res) => {
  try {
    const grantType = req.body?.grant_type;
    const clientId = req.body?.client_id;
    const clientSecret = req.body?.client_secret;

    if (!grantType) {
      res.status(400).json({error: "invalid_request", error_description: "grant_type is required"});
      return;
    }
    if (!clientId) {
      res.status(400).json({error: "invalid_request", error_description: "client_id is required"});
      return;
    }

    let response;
    if (grantType === "authorization_code") {
      response = await handleAuthorizationCodeGrant({
        code: req.body?.code,
        clientId,
        clientSecret,
      });
    } else if (grantType === "refresh_token") {
      response = await handleRefreshTokenGrant({
        refreshToken: req.body?.refresh_token,
        clientId,
        clientSecret,
      });
    } else {
      res.status(400).json({error: "unsupported_grant_type"});
      return;
    }

    res.status(200).json(response);
  } catch (error) {
    logger.error("Alexa token endpoint failure", {error: error.message});
    const errorCode = typeof error.code === "string" ? error.code : "internal";
    let status = 500;
    let oauthError = "server_error";

    switch (errorCode) {
    case "permission-denied":
    case "unauthenticated":
      status = 401;
      oauthError = "invalid_client";
      break;
    case "invalid-argument":
      status = 400;
      oauthError = "invalid_request";
      break;
    case "not-found":
    case "deadline-exceeded":
      status = 400;
      oauthError = "invalid_grant";
      break;
    case "resource-exhausted":
      status = 429;
      oauthError = "temporarily_unavailable";
      break;
    default:
      status = 500;
      oauthError = "server_error";
      break;
    }

    res.status(status).json({
      error: oauthError,
      error_description: error.message || "Unexpected error",
    });
  }
});

alexaAuthApp.get("/", (req, res) => {
  res.status(200).send("ok");
});

exports.alexaAuthService = onRequest((req, res) => alexaAuthApp(req, res));

exports.acceptInvite = onCall({cors: true}, async (request) => {
  const inviteCode = request.data?.inviteCode;
  if (!inviteCode || typeof inviteCode !== "string") {
    throw new HttpsError("invalid-argument", "有効な招待コードを指定してください。");
  }

  const userId = request.data?.userId;
  if (!userId || typeof userId !== "string") {
    throw new HttpsError("invalid-argument", "有効なユーザーIDを指定してください。");
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

    const alreadyMember = members.includes(userId);
    if (!alreadyMember) {
      members.push(userId);
      transaction.update(listRef, {
        members,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    transaction.update(inviteRef, {
      status: "used",
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
      usedBy: userId,
    });

    return {listId, alreadyMember};
  });

  logger.info("Invite accepted", {inviteCode, userId, listId: result.listId});

  return {
    listId: result.listId,
    alreadyMember: result.alreadyMember,
  };
});

exports.createAlexaLinkCode = onCall({cors: true}, async (request) => {
  const listId = request.data?.listId;
  if (!listId || typeof listId !== "string") {
    throw new HttpsError("invalid-argument", "有効なリストIDを指定してください。");
  }

  const userId = request.data?.userId;
  if (!userId || typeof userId !== "string") {
    throw new HttpsError("invalid-argument", "有効なユーザーIDを指定してください。");
  }

  const listRef = db.collection("lists").doc(listId);
  const listSnap = await listRef.get();
  if (!listSnap.exists) {
    throw new HttpsError("not-found", "指定されたリストが見つかりませんでした。");
  }
  const listData = listSnap.data();
  const members = Array.isArray(listData.members) ? listData.members : [];
  if (!members.includes(userId)) {
    throw new HttpsError("permission-denied", "このリストに対する権限がありません。");
  }

  const expiresAtDate = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60 * 1000);
  const expiresTimestamp = admin.firestore.Timestamp.fromDate(expiresAtDate);

  let code;
  let created = false;
  for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
    code = generateRandomCode(6);
    const codeRef = linkCodeCollection.doc(code);
    try {
      await codeRef.create({
        uid: userId,
        listId,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: expiresTimestamp,
      });
      created = true;
    } catch (error) {
      if (error.code !== 6) {
        throw new HttpsError("internal", "リンクコードの生成に失敗しました。", error.message);
      }
    }
  }

  if (!created || !code) {
    throw new HttpsError("resource-exhausted", "リンクコードを生成できませんでした。時間をおいて再試行してください。");
  }

  return {
    code,
    expiresAt: expiresAtDate.toISOString(),
    ttlMinutes: LINK_CODE_TTL_MINUTES,
  };
});
