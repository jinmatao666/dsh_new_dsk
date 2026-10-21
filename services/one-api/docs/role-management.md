# Role management

English | [中文](role-management.zh.md)

Role definitions are stored in the main OneAPI database's `public.roles` table. `users.role` stores the assigned code; these definitions are not in the account-center database.

Creating a role requires a name and `role_type` (`member` or `admin`). The server allocates an unused code within the existing authorization bands: members 2–9, administrators 10–99. It also skips codes referenced by legacy users without a role definition. Clients cannot choose a code or create a super-administrator. Only a super-administrator may create or delete administrator roles. Existing numeric authorization comparisons remain unchanged.

The built-in member (1), super-administrator (100), and any role marked `is_builtin` cannot be deleted. `DELETE /api/role/:role` rejects roles referenced by any user, including soft-deleted users. Reassign users before deleting a custom role. Deletion does not alter user accounts. Successful deletion removes the role from the frontend's role cache.

The create dialog offers member/administrator selection, automatic numbering, inline failures and a pending-request guard. Deletion requires a separate confirmation. The role list retains model configuration and labels each role's authorization category. The model dialog's select-all and invert actions apply to the complete displayed catalog, including scrolled-off entries. They preserve existing permissions absent from the catalog and only persist after Save; Cancel discards changes. Bulk actions are disabled while loading or when the catalog is empty.

Verification: `go test ./controller -run '^TestManagedRoleLifecycle$' -count=1` and the frontend `RolePermissions.test.js`. Go tests use isolated SQLite or a temporary PostgreSQL schema when `DSH_SKILL_INSTALLATION_TEST_POSTGRES_DSN` is supplied; never use production credentials for tests.
