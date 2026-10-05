// POST /v1/me/notifications/read-all?experience=…
//
// R17-B — `ids` names the unread notifications the reader was shown (1–100).
// Only the caller's own, live, unread rows among them, within the experience,
// become read; every other row is left as it is — in particular one that
// arrived, or whose transaction committed, after the list was read. Unknown,
// foreign, deleted, already-read and other-experience ids are ignored.
//
// The pre-R17-B bodyless call ("everything unread now") is refused with 400:
// it could mark notifications the reader never saw.
export interface MarkAllNotificationsReadRequest {
  ids: string[];
}
