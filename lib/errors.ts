/* Turn an unknown thrown value into a human-readable message.

   MediaPipe (and the <video> element) reject/throw with a DOM `Event`, not
   an `Error`. Passing that to `String()` yields the useless "[object Event]";
   this normalises such values into something a user can act on. */

export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "string") return e;
  if (typeof Event !== "undefined" && e instanceof Event) {
    return `unexpected media error (${e.type || "event"})`;
  }
  return String(e);
}
