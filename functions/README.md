# Shopping List Cloud Functions

This package hosts backend APIs for the shopping list application. All callable
endpoints now require Firebase Authentication and derive the caller's identity
from the auth context rather than trusting a `userId` provided in the payload.
Any `userId` value that is sent is validated against the authenticated UID and
ignored if it does not match.

## Functions

- **acceptInvite** (Callable)
  - **Payload:** `{ inviteCode: string, userId?: string }`
  - **Auth:** Firebase Authentication（必須 / UID を利用）
  - **Behaviour:**
    - Validates the invite document under `invites/{inviteCode}`.
    - Verifies the invite is active and not expired.
    - 認証済みユーザーの UID を `lists/{listId}.members` 配列に追加
      (if not already present) inside a Firestore transaction.
    - Marks the invite as `used` with timestamps and returns `{ listId,
      alreadyMember }`.

- **createAlexaLinkCode** (Callable)
  - **Payload:** `{ listId: string, userId?: string }`
  - **Auth:** Firebase Authentication（必須 / UID を利用）
  - **Behaviour:**
    - Confirms the requester belongs to the specified list.
    - Generates a short-lived link code that can be entered during Alexa account linking.
    - Stores metadata (`uid`, `listId`, expiry) for 後続の OAuth フローに利用します。

- **registerDeviceRecovery** (Callable)
  - **Payload:** `{ listId: string, userId?: string, recoveryKey?: string }`
  - **Auth:** Firebase Authentication（必須 / UID を利用）
  - **Behaviour:**
    - Ensures the caller is already a member of the referenced list.
    - Issues (or refreshes) a long, random recovery key that can be cached on the device.
    - Persists the key under `deviceRecoveryKeys/{sha256(key)}` so it can later be claimed.

- **claimDeviceRecovery** (Callable)
  - **Payload:** `{ recoveryKey: string, userId?: string }`
  - **Auth:** Firebase Authentication（必須 / UID を利用）
  - **Behaviour:**
    - Looks up the hashed recovery key, verifies it is still active, and fetches the associated list.
    - 認証済み UID を必要に応じて `lists/{listId}.members` に追加します。
    - Updates metadata on the recovery document (`lastClaimed*`) and returns `{ listId, listName, alreadyMember }`.

- **trimListMembers** (Callable)
  - **Payload:** `{ listId: string, userId?: string, keepMembers: string[] }`
  - **Auth:** Firebase Authentication（必須 / UID を利用）
  - **Behaviour:**
    - 認証済み UID がリストのメンバーであることを確認したうえで、指定された `keepMembers` と現在の `members` を突き合わせます。
    - 呼び出した端末（認証済み UID）を必ず残す状態で `lists/{listId}.members` を更新します。
    - Returns `{ members: string[], removedCount: number, memberProfiles: Record<string, string> }` so the UI can refresh both the membership list and any device labels.

- **updateDeviceProfile** (Callable)
  - **Payload:** `{ listId: string, userId?: string, memberId: string, displayName: string }`
  - **Auth:** Firebase Authentication（必須 / UID を利用）
  - **Behaviour:**
    - Validates that both the caller and the target `memberId` belong to the list.
    - Stores/clears a friendly `displayName` for the member under `lists/{listId}.memberProfiles`.
    - Returns `{ memberProfiles: Record<string, string> }` representing the latest device labels.

> **Security note:** Firestore セキュリティルールでも、`lists/{listId}` の
> `members` を適切に保護できるよう Firebase Authentication を前提とした
> 検証ロジックを併用してください。匿名 UID を利用する場合でも、Cloud Functions
> 側での UID 検証によりユーザーなりすましを防ぎます。

Future API endpoints (e.g. Alexa facing CRUD operations) can be added to this
module as new callable or HTTP functions.
