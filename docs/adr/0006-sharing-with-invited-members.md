# 0006 · Sharing with invited members

- **Date:** 2026-08-15
- **Status:** accepted
- **Partially supersedes:** [`0002-eventos-privados-por-usuario.md`](0002-eventos-privados-por-usuario.md)

## Context

ADR 0002 made events private per user and closed with this sentence:

> Sharing an event with someone else will require a model change, such as a
> visibility field or a collection of guests. Not planned.

It is planned now: it is F2 of [`../spec-fase-2.md`](../spec-fase-2.md). What
does not change is 0002's premise — events are **not** public — but their
exclusivity: they stop belonging to a single person.

A public read-only link with a token was considered first. It was dropped
because the requirement was to **collaborate**, not to publish: another
identified person needs to be able to edit, and an anonymous token cannot tell
who is writing.

## Decision

An event has an **owner** and a list of **guests with a role**, both stored in
the document itself:

```
events/{eventId}
  userId: string                                   # owner, immutable
  memberIds: string[]                              # includes the owner
  roles: { [uid]: "viewer" | "editor" }            # guests only
```

Three roles, and what each may do:

| | Read | Edit content | Invite, remove, change roles | Delete the event | Leave |
| --- | --- | --- | --- | --- | --- |
| Owner | yes | yes | yes | yes | **no** |
| Editor | yes | yes | no | no | yes |
| Viewer | yes | no | no | no | yes |

### Membership in the document, not in a subcollection

The initial sketch drew an `events/{id}/members/{uid}` subcollection with rules
doing `get()` against it. Rejected for three reasons:

1. **`memberIds` as an array is needed anyway.** Without it there is no
   `where('memberIds', 'array-contains', uid)` query to feed the "shared with
   me" inbox. With the subcollection it would have to be denormalised all the
   same, and then the subcollection only adds a second place for the truth to
   drift.
2. **Every `get()` in a rule is a billable read per evaluation.** With roles in
   the document, the rule reads nothing extra.
3. **The risk that justified the subcollection is closed by a condition.** An
   editor promoting themselves is prevented by requiring that, in their
   `update`, `userId`, `memberIds` and `roles` all stay identical.

### Anyone may remove themselves, and only themselves

This is the single exception to "only the owner touches membership". It is
accepted for two reasons: without it, deleting an account (F14) would strand
memberships in other people's events that nobody could then touch; and someone
who has been shared something they do not care about has to be able to get rid
of it.

**Verified against the emulator before writing this ADR** — not assumed — that
the rules language can express it precisely:

```
function leavesTheEvent() {
  return uid() != resource.data.userId
      && uid() in resource.data.memberIds
      && request.resource.data.memberIds == resource.data.memberIds.removeAll([uid()])
      && request.resource.data.roles.diff(resource.data.roles)
           .affectedKeys().hasOnly([uid()].toSet())
      && request.resource.data.diff(resource.data)
           .affectedKeys().hasOnly(['memberIds', 'roles'].toSet());
}
```

`List.removeAll()`, `Map.diff().affectedKeys()` and `hasOnly()` exist and behave
as expected. The last condition is what stops a content change being smuggled
inside an "I'm leaving": without it, leaving an event would be a door to
editing it.

And the owner **cannot** leave: it would strand the event with nobody to
administer it. To be rid of it, they delete it.

## Reasons

- Identified guests make it possible to tell who is writing, which an anonymous
  link does not give.
- Denormalisation is mandatory given how Firestore queries, so the subcollection
  added cost without adding guarantees.
- It keeps standing the rule 0002 wrote in blood: **one `allow` rule per
  operation**. The owner and editor conditions are OR-ed **inside** the same
  `allow`, not across two separate ones.

## Consequences

- **Phase 1 events have no `memberIds` and would vanish from the listing**,
  because the query moves to `array-contains`. It needs a backfill
  (`memberIds = [userId]`, `roles = {}`) before deploying. With no real users
  yet, the cost is zero if it is done now.
- ADR 0002 still stands in essence: without being owner or guest, nothing is
  readable. What is superseded is exclusivity, not privacy.
- **Images do not follow this logic.** The URL from `getDownloadURL()` carries a
  bearer token that bypasses Storage rules, so whoever saw an event's cover
  keeps seeing it after being removed. Revoking that token requires the Admin
  SDK. It is a known and accepted limitation, already recorded in `AGENTS.md`;
  closing it is a separate ADR.
- The number of guests per event is capped in the rule, so `roles` cannot grow
  unbounded inside the document.
- There are no pending invitations: see
  [`0006`](0007-client-side-user-directory.md).
