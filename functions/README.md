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

> **Security note:** Firestore セキュリティルールでは `lists/{listId}` の
> `members` を安全に管理できるよう、匿名IDベースの検証ロジックを合わせて
> 運用してください。

Future API endpoints (e.g. Alexa facing CRUD operations) can be added to this
module as new callable or HTTP functions.
