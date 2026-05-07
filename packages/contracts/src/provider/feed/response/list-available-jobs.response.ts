import type { AvailableJobSummary } from './available-job-summary';

// GET /v1/me/provider/jobs/available
//
// Cursor-paginated list of open service requests the calling provider
// may bid on. Page size and ordering are owned by the server.
export interface ListAvailableJobsResponse {
  items: AvailableJobSummary[];
  // Cursor for the next page (id of the last item in this page) when a
  // further page may exist; null when this is the last page.
  nextCursor: string | null;
}
