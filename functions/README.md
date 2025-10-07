# Shopping List Cloud Functions

This package hosts backend APIs for the shopping list application. The first
endpoint is a callable function that accepts shared list invitations on behalf
of an authenticated user.

## Functions

- **acceptInvite** (Callable)
  - **Payload:** `{ inviteCode: string }`
  - **Auth:** Requires Firebase Authentication with a valid ID token.
  - **Behaviour:**
    - Validates the invite document under `invites/{inviteCode}`.
    - Verifies the invite is active and not expired.
    - Adds the caller's UID to the corresponding `lists/{listId}.members` array
      (if not already present) inside a Firestore transaction.
    - Marks the invite as `used` with timestamps and returns `{ listId,
      alreadyMember }`.

> **Security note:** Firestore セキュリティルールでは `lists/{listId}` の
> `members` をクライアントから直接更新できないようにしておき、この関数が
> 唯一メンバーを追加する手段になるよう想定しています。

Future API endpoints (e.g. Alexa facing CRUD operations) can be added to this
module as new callable or HTTP functions.
