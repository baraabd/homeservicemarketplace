// When the requester wants the work performed.
//   ASAP  — schedule at provider discretion as soon as possible
//   LATER — `scheduledAt` MUST be set on the request
export const ScheduleType = {
  Asap: 'ASAP',
  Later: 'LATER',
} as const;
export type ScheduleType = (typeof ScheduleType)[keyof typeof ScheduleType];
