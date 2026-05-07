// GET /v1/admin/roles
//
// Read-only list of every Role row. The User Control filter chips
// pull their available role-name values from here so the UI never
// hardcodes 'admin' / 'provider' / 'customer' and stays in sync if
// the seed grows.
export interface AdminRoleSummary {
  id: string;
  name: string;
  // Optional description if the schema carries one. Many seeds leave
  // it null and the UI just falls back to the role name.
  description: string | null;
}

export interface ListAdminRolesResponse {
  items: AdminRoleSummary[];
}
