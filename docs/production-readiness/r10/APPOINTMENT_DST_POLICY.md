# R10 — Weekly hours, appointments and daylight saving time

This document separates three things that are easy to confuse. It records what
the repository does today. It does not introduce behaviour.

## A. Weekly hours policy (implemented, proved in R10)

A provider's working hours are a **recurring local wall-clock schedule in one
IANA time zone**.

- A window is `dayOfWeek` (0 = Sunday … 6 = Saturday), `startMinute` inclusive,
  `endMinute` exclusive, both counted from local midnight. `1440` is midnight as
  an end.
- The zone is stored on every interval row
  (`ProviderAvailabilityInterval.timezone`); all rows of one provider carry the
  same zone.
- "Monday 09:00–17:00, Europe/Stockholm" means 09:00 to 17:00 on the wall clock
  in Stockholm every Monday, in winter and in summer. It is **not** a pair of
  UTC instants and is never converted into one for storage.
- Daylight saving time therefore does not change any stored value. Minutes are
  never shifted when the zone's offset changes, when the provider changes zone,
  or when the provider moves to another market: only the wall clock the minutes
  are read against changes.

Executed evidence (`r10-working-hours-durability.integration.spec.ts`,
`r10-working-hours-schedule-durability.real-api.spec.ts`):

- changing the zone of a stored week restamps every row and leaves every minute
  as it was;
- changing market restamps to the new market's zone with the same minutes;
- the rows are compared with PostgreSQL directly, as integers.

The only place the server evaluates a zone against a date is to print an offset
label for the provider ("Times are shown in Damascus time (UTC+3)") in
`service-area/timezone-resolution.ts`, using the runtime's IANA database and
the current date. It is a label. Nothing is stored from it and nothing is
decided by it.

## B. Appointment timestamp policy (what exists today)

An appointment is an **instant**, not a weekly rule.

- A service request carries `scheduledAt`, a timestamp supplied by the seeker's
  client and stored as an instant. R07 added the rule that it may not be in the
  past.
- A booking is created from an accepted bid on a request and inherits that
  instant.

**Nothing in the repository connects an appointment instant to a provider's
weekly hours.** Verified by search in R10:

- no code outside onboarding and admin review reads
  `ProviderAvailabilityInterval`;
- matching, the provider feed, bidding and booking do not consult weekly hours;
- there is no conversion of weekly minutes into instants, and no library for
  zone arithmetic (no Luxon, date-fns-tz or Temporal) in the API.

So today a provider's weekly hours are information the provider declares and an
administrator reviews. They do not accept, refuse or filter any request or
booking.

## C. DST ambiguity and nonexistent local times (NOT IMPLEMENTED)

Deciding whether an appointment instant falls inside a provider's weekly hours
needs a rule for two cases that a weekly wall-clock schedule cannot answer by
itself:

- **Spring forward — a local time that does not exist.** In a zone that moves
  its clocks forward at 02:00, the local times from 02:00 to 02:59 do not occur
  on that date. A window `01:00–04:00` is then two hours long, not three.
- **Fall back — a local time that occurs twice.** In a zone that moves its
  clocks back at 03:00, the local times from 02:00 to 02:59 occur twice. A
  window `01:00–04:00` is then four hours long, and "02:30" names two instants.

**The repository has no policy for either case, because nothing compares an
instant with weekly hours.** There is no behaviour to test and R10 adds none.
Inventing one here would be inventing product behaviour.

Whoever first builds a feature that compares appointments with weekly hours
(availability-aware matching, booking validation, a calendar) must decide, and
test, at least:

1. the zone the comparison is made in (the provider's stored zone, never the
   server's or the viewer's);
2. conversion of the appointment instant to that zone's local date, weekday and
   minute using the IANA database, not a fixed offset;
3. the fall-back hour: whether either occurrence of a repeated local time
   counts as inside a window (the natural reading is yes for both);
4. the spring-forward hour: that a nonexistent local time can never be an
   appointment's local time, so windows covering it are simply shorter that
   day;
5. windows that end at `1440` and continue on the next day at `0`, across a
   date on which the offset changes.

Zones differ, and change. The supported markets must not be assumed to observe
or not observe DST: the answer comes from the runtime IANA database for the
date in question.

## Summary

| Question                                                    | Answer today                         |
| ----------------------------------------------------------- | ------------------------------------ |
| Are weekly hours stored as local wall-clock minutes?        | Yes; proved                          |
| Does DST change stored weekly hours?                        | No; proved                           |
| Does changing zone or market shift minutes?                 | No; proved                           |
| Are weekly hours converted to UTC instants anywhere?        | No                                   |
| Do weekly hours restrict requests, bids or bookings?        | No                                   |
| Is there a policy for ambiguous or nonexistent local times? | No. Not implemented and not invented |
