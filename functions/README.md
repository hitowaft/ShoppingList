# Shopping List Cloud Functions

This package hosts backend APIs for the shopping list application. The callable
functions now operate in conjunction with匿名UUIDセッションを想定しており、クライアントが
自分のユーザーIDをリクエストペイロードに渡す設計になっています。

## Functions

- **acceptInvite** (Callable)
  - **Payload:** `{ inviteCode: string, userId: string }`
  - **Auth:** なし（ユーザーIDで所有者確認を行う）
  - **Behaviour:**
    - Validates the invite document under `invites/{inviteCode}`.
    - Verifies the invite is active and not expired.
    - Adds the provided `userId` to the corresponding `lists/{listId}.members` array
      (if not already present) inside a Firestore transaction.
    - Marks the invite as `used` with timestamps and returns `{ listId,
      alreadyMember }`.

- **createAlexaLinkCode** (Callable)
  - **Payload:** `{ listId: string, userId: string }`
  - **Auth:** なし（リストの`members`に`userId`が含まれるか検証）
  - **Behaviour:**
    - Confirms the requester belongs to the specified list.
    - Generates a short-lived link code that can be entered during Alexa account linking.
    - Stores metadata (`uid`, `listId`, expiry) for後続のOAuthフローに利用します。

- **registerDeviceRecovery** (Callable)
  - **Payload:** `{ listId: string, userId: string, recoveryKey?: string }`
  - **Auth:** なし（リストの`members`に`userId`が含まれるか検証）
  - **Behaviour:**
    - Ensures the caller is already a member of the referenced list.
    - Issues (or refreshes) a long, random recovery key that can be cached on the device.
    - Persists the key under `deviceRecoveryKeys/{sha256(key)}` so it can later be claimed.

- **claimDeviceRecovery** (Callable)
  - **Payload:** `{ recoveryKey: string, userId: string }`
  - **Auth:** なし（recovery key に紐付いたリスト情報で権限を検証）
  - **Behaviour:**
    - Looks up the hashed recovery key, verifies it is still active, and fetches the associated list.
    - Adds the provided `userId` to `lists/{listId}.members` if 必要であれば追加します。
    - Updates metadata on the recovery document (`lastClaimed*`) and returns `{ listId, listName, alreadyMember }`.

- **trimListMembers** (Callable)
  - **Payload:** `{ listId: string, userId: string, keepMembers: string[] }`
  - **Auth:** なし（リストの`members`に`userId`が含まれるか検証）
  - **Behaviour:**
    - Ensures the caller belongs to the list, then intersects the provided `keepMembers` with the current `members` array.
    - Guarantees at least one member (呼び出した端末) を残した状態で `lists/{listId}.members` を更新します。
    - Returns `{ members: string[], removedCount: number, memberProfiles: Record<string, string> }` so the UI can refresh both the membership list and any device labels.

- **updateDeviceProfile** (Callable)
  - **Payload:** `{ listId: string, userId: string, memberId: string, displayName: string }`
  - **Auth:** なし（リストの`members`に`userId`が含まれるか検証）
  - **Behaviour:**
    - Validates that both the caller and the target `memberId` belong to the list.
    - Stores/clears a friendly `displayName` for the member under `lists/{listId}.memberProfiles`.
    - Returns `{ memberProfiles: Record<string, string> }` representing the latest device labels.

> **Security note:** Firestore セキュリティルールでは `lists/{listId}` の
> `members` を安全に管理できるよう、匿名IDベースの検証ロジックを合わせて
> 運用してください。

Future API endpoints (e.g. Alexa facing CRUD operations) can be added to this
module as new callable or HTTP functions.
