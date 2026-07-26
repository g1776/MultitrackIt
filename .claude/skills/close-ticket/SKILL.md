---
name: close-ticket
description: "Close a ticket properly: validate its acceptance criteria are actually met (not just read), comment only if there's something worth recording, update tickets it blocks, and run the repo's triage bookkeeping."
argument-hint: "<issue number>"
disable-model-invocation: true
---

# Close Ticket

Closes one GitHub issue in this repo correctly — verified, not rubber-stamped. Follows the conventions in `docs/agents/issue-tracker.md` (issue tracker mechanics) and `docs/agents/triage-labels.md` (label vocabulary). Read both before acting if you haven't already this session.

## 1. Resolve the ticket

Get the issue number from the invocation (`/close-ticket 42`, or however the user phrased it). If it's missing or ambiguous, ask.

Fetch it per `docs/agents/issue-tracker.md`:

```
gh issue view <n> --comments --json number,title,body,labels,comments,state
```

If it's already closed, say so and stop — don't re-close or re-comment unless the user is explicitly asking you to re-verify or reopen it.

## 2. Reuse whatever `/implement` already established — don't redo it

This skill is normally invoked right after `/implement` finished the same ticket in the same conversation. `/implement` already ran the full test suite once at the end and ran `/code-review` (a Standards sub-agent and a Spec sub-agent, the latter diffing the code against this exact issue's acceptance criteria). Before doing anything below, check the conversation for that output and treat it as already-done work, not a prompt to start over:

- **Don't re-run the full test suite.** If `/implement` just ran it clean, that's current. Only re-run something narrower if you have a specific reason to think it's stale (more edits happened after the last run).
- **Don't re-derive a diff-vs-spec analysis yourself.** The `/code-review` Spec sub-agent already answered "which acceptance criteria does the diff satisfy, which are missing, is there scope creep" by reading the actual diff. Reuse its verdict per criterion instead of re-reading the whole diff line by line in step 3.
- **Do still separately check anything code-review couldn't answer by reading a diff** — criteria that require *observing runtime behavior* rather than static inspection (a UI actually working, a real-hardware run, an end-to-end scenario producing real numbers). Static review can tell you the code path exists; it can't tell you it actually ran. If the user already showed you that output earlier in this conversation (e.g. a report file, a screenshot, pasted command output), that counts as verification — don't manufacture a redundant re-run of something already observed.

If there's no fresh `/implement`/`/code-review` context at all (a cold invocation on an older ticket, a different conversation), fall back to doing the full check yourself in step 3 — read the current code against each criterion, and drive real behavior where the criterion calls for it.

## 3. Validate the acceptance criteria — the main gate

Parse the acceptance-criteria checklist out of the body (usually under an `## Acceptance criteria` heading, as `- [ ]` / `- [x]` lines). If there's no checklist at all, note that and move on to step 5 — there's nothing structural to validate, but still skim the issue for other signs it's actually done (e.g. a "Blocked by" note that no longer applies).

For every box already checked `[x]`, trust it — don't re-verify work a previous close-out already confirmed unless something about this session suggests it regressed.

For every unchecked `[ ]` box, resolve it using step 2's reuse first — the Spec sub-agent's per-criterion verdict, or behavior already observed earlier in this conversation. Only for what's left unresolved after that, per `docs/agents/issue-tracker.md`'s rule, **drive the actual behavior, don't just read the code**: run the app, run the relevant test file, run the scenario the ticket describes, whatever it takes to actually observe the thing happening.

Sort each unchecked box into exactly one of:

- **Verifiable now** — you drove the behavior and it held up. Check it off and keep a one-line note of *how* you verified it (what you ran, what you saw) for the closing comment.
- **Genuinely unmet** — the behavior doesn't hold, or you can't verify it (no way to drive it, insufficient access, etc.). **Stop here.** Tell the user exactly which criteria are unmet or unverifiable and what's needed to finish them. Do not check the box, do not close the issue, do not guess.
- **Deferred / descoped / superseded** — leave the box unchecked, but only with an explicit reason (superseded by #N, out of scope, deliberately dropped). If it's being deferred rather than intentionally dropped, file a follow-up issue for it now, and reference that issue in the reason.

If anything landed in "genuinely unmet," the skill ends here — report the gap and don't proceed to closing.

## 4. Decide whether a closing comment is needed

Don't post one by default. A comment is warranted only when there's something worth recording:

- verification evidence (what you ran, what it showed — especially for criteria that needed driving real behavior)
- any boxes left unchecked, with their reason
- a pointer to the commit(s)/PR that implemented the work, if the issue body doesn't already carry that
- follow-up issues filed as part of step 3

If none of that applies — everything was already checked off before you started and there's nothing new to say — close without a comment rather than writing one for its own sake.

If you did check boxes in step 3, push the updated body first:

```
gh issue edit <n> --body-file -
```

## 5. Update tickets this one affects

**Tickets blocked by this one.** Find them via native issue dependencies and via plain-text `Blocked by #<n>` lines (`gh issue list --state open --json number,body,title` and grep, or the dependencies API per `docs/agents/issue-tracker.md`'s wayfinding section). For each:

- If this was its only remaining open blocker, note that it's now unblocked — strike or remove the `Blocked by #<n>` reference (or the native dependency edge) and leave a short comment saying what unblocked it.
- Don't relabel that ticket's triage state yourself (e.g. don't decide it's now `ready-for-agent`) — that's a judgment call for `/triage`, not this skill. Mention to the user that it's now unblocked and worth a `/triage` pass.

**Parent/spec tickets.** If this issue says it's a sub-issue of another (e.g. "Sub-issue of the spec #13") and that parent tracks children as a manual task list rather than native GitHub sub-issues, check off this ticket's line there too.

## 6. Triage bookkeeping (`docs/agents/triage-labels.md`)

A closed issue doesn't sit in the open-triage pipeline anymore, so remove whichever of the five canonical state labels is currently applied — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` — translated to this repo's actual label string via the table in `docs/agents/triage-labels.md`. Leave any category label (e.g. `bug`/`enhancement`) in place; that's a historical classification, not a pipeline state.

If the reason you're closing is actually "won't fix" rather than "done," this isn't the right skill — that's `/triage`'s wontfix flow, which writes to `.out-of-scope/` and has its own comment conventions. Stop and point the user there instead.

## 7. Close

```
gh issue close <n> [--comment "<step-4 comment>"]
```

Report back concisely: which criteria you verified and how, anything left unchecked and why, which other tickets got updated (and how), and which labels were removed.
