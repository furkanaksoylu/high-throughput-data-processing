export const AUTH_ROLES = ["admin", "author", "moderator", "user"] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export const IMPORT_ALLOWED_ROLES: AuthRole[] = ["admin", "author"];
export const EXPORT_ALLOWED_ROLES: AuthRole[] = ["admin", "author", "moderator", "user"];

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  active: boolean;
};
