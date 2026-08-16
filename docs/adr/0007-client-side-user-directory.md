# 0007 · The user directory lives in the client

- **Date:** 2026-08-15
- **Status:** accepted
- **Complements:** [`0006-sharing-with-invited-members.md`](0006-sharing-with-invited-members.md)

## Context

ADR 0006 decides to invite identified people. That means turning what the user
types — an email — into what the rules understand — a `uid` — and **Firebase
Auth exposes no directory to clients**: `getUserByEmail()` belongs to the Admin
SDK and only runs on a server.

Without solving this, sharing does not exist. And the project has no server:
there are no Cloud Functions, and the Blaze plan is out of scope on recurring
cost grounds.

## Decision

Each user **publishes their own entry** in a directory collection whose id is
the SHA-256 hash of their email:

```
userDirectory/{sha256Hex(email.trim().toLowerCase())}
  uid: string
  displayName: string
  photoURL: string
```

It is written on sign-in. To invite, the client hashes the address it was given
and does **a single `get`** on that document.

Three conditions in the rules make it safe:

1. **The entry is tied to the token's email.** The rule checks
   `emailHash == hashing.sha256(request.auth.token.email.lower()).toHexString().lower()`,
   and only if `email_verified` is true. Without this, anyone could register
   with someone else's address and point that hash at their own `uid`, keeping
   the invitations meant for them.
2. **It cannot be listed** (`allow list: if false`). Only `get` by exact hash.
   That is what separates "check an address you already know" from "download
   the census".
3. **`hasOnly` on the three fields**, so nobody uses their entry as a store for
   arbitrary data.

That the hash comparison works **was verified against the emulator before
adopting it**: the rules' `hashing.sha256().toHexString()` matches
`createHash("sha256").digest("hex")` from Node exactly.

### A second index, by uid

Events store uids, and an email hash does not invert, so showing the guest list
needs `userProfiles/{uid}` with the display name and photo. It carries no
email: sharing an event should not hand out addresses.

### Pending invitations do not need a backend after all

An earlier draft of this ADR claimed the opposite, and it was wrong. It argued
that the invitee would have to add themselves to `memberIds` without being able
to read the event first — reading requires membership — and called that a closed
circle without a server.

The circle is not closed. `arrayUnion(uid)` and a dotted `roles.<uid>` path let
the client write without knowing the previous contents, and the rule checks the
result against `resource.data.memberIds.concat([uid()])` plus a `get()` on the
invitation. No Cloud Function, no Blaze.

So membership is consensual: `eventInvites/{eventId}_{inviteeUid}` holds the
offer, the owner is the only one who may create it, and only the invitee turns
it into membership — accepting and clearing the invitation in one batch. What
that buys is not politeness: without it, knowing someone's email is enough to
put arbitrary content in their listing, repeatedly, and they cannot delete it
because only the owner can.

What still needs a server is inviting someone who has **no account yet**: there
is no `uid` to name, and nobody to apply the invitation when they eventually
sign up. The application says so plainly and offers a sign-up link.

## Alternatives rejected

| Alternative | Why not |
| --- | --- |
| A Cloud Function resolving the email | Requires the Blaze plan and recurring cost, out of scope |
| A `users` collection queried with `where('email','==',…)` | A query is a `list`, and allowing `list` opens up sweeping the whole census |
| An invitation link with a token the guest accepts | The guest would have to add themselves to `memberIds` without being able to read the document first, because reading requires membership. A closed circle without a backend |
| Storing the email in clear as the document id | Exposes emails in paths and in any error log |

## Consequences

- **It is possible to check whether a given email is registered.** That is
  inherent to inviting by email: if the application tells you "invited" or "no
  account", it is already telling you. Forbidding `list` bounds it, but does not
  remove it. It must be reflected in the privacy policy (F13).
- The directory needs maintaining: if someone changes their email, the old entry
  is orphaned. Account deletion (F14) has to clean it up.
- **Accounts created with email and password are invisible until verified**, so
  sign-up sends a verification email and the profile says as much.
- If Cloud Functions ever arrive for another reason, **this decision is worth
  revisiting**: with a server, pending invitations and email resolution are done
  better and without publishing anything.
