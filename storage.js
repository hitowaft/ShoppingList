import { db, doc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch } from "./firebase.js";

const listItemsCollection = (listId) => collection(db, "lists", listId, "items");

/**
 * アイテムの購入済み状態（completed）を更新する関数
 * @param {string} id - 更新するアイテムのドキュメントID
 * @param {boolean} currentCompleted - 現在の購入済み状態
 * @param {string} listId - 操作対象のリストID
 */
export async function updateItemStatus(id, currentCompleted, listId) {
  if (!listId) return;
  try {
    const newCompleted = !currentCompleted;

    const itemRef = doc(listItemsCollection(listId), id);

    await updateDoc(itemRef, {
      completed: newCompleted
    });

    console.log("ドキュメントの更新に成功しました！ ID:", id);
  } catch (error) {
    console.error("ドキュメントの更新中にエラーが発生しました:", error);
    throw error;
  }
}

/**
 * アイテムをFirestoreから削除する関数
 * @param {string} id - 削除するアイテムのドキュメントID
 * @param {string} listId - 操作対象のリストID
 */
export async function deleteDbItem(id, listId) {
  if (!listId) return;
  try {
    // --- ここからチャレンジ！ ---
    const itemRef = doc(listItemsCollection(listId), id);

    await deleteDoc(itemRef);

    console.log("ドキュメントの削除に成功しました！ ID:", id);

  } catch (error) {
    console.error("ドキュメントの削除中にエラーが発生しました:", error);
  }
}

/**
 * Firestoreから完了済みのアイテムをすべて削除する関数
 * @param {string} listId - 操作対象のリストID
 */
export async function clearCompletedDbItems(listId) {
  if (!listId) return [];

  const q = query(listItemsCollection(listId), where("completed", "==", true));
  const querySnapshot = await getDocs(q);
  const completedDocs = querySnapshot.docs;

  // Firestore のバッチ上限を超えないよう分割して削除する。
  const batchSize = 450;
  for (let offset = 0; offset < completedDocs.length; offset += batchSize) {
    const batch = writeBatch(db);
    completedDocs.slice(offset, offset + batchSize).forEach((itemDoc) => {
      batch.delete(itemDoc.ref);
    });
    await batch.commit();
  }

  return completedDocs.map((itemDoc) => itemDoc.id);
}

/**
 * アイテムのテキスト(name)をFirestore上で更新する関数
 * @param {string} id - 更新するアイテムのドキュメントID
 * @param {string} newText - 新しいテキスト
 * @param {string} listId - 操作対象のリストID
 */
export async function updateDbItemText(id, newText, listId) {
  if (!listId) return;
  try {
    // 1. 更新対象のドキュメントへの参照を作成する
    const itemRef = doc(listItemsCollection(listId), id);

    // 2. updateDocを使って、nameフィールドをnewTextの値で更新する
    await updateDoc(itemRef, {
      name: newText
    });

    console.log("テキストの更新に成功しました！ ID:", id);

  } catch (error) {
    console.error("テキストの更新中にエラーが発生しました:", error);
  }
}

