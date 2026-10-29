# Agent Note: Configurable government organization tree

Status: implemented

English | [中文](2026-10-24-government-organization-tree.zh.md)

## Problem

Public-sector customers organize people across varying jurisdictions, agencies, subordinate units and internal teams. A fixed number of department levels cannot represent these hierarchies. The existing `organizations` table represents billable enterprise accounts and has different ownership and lifecycle rules.

## Decision

Direct user affiliations use the separate `government_organization_members` composite-key table, allowing zero or multiple organizations per account without changing permission roles. The user editor presents Department below Role, selects one path level at a time, and submits all chosen node IDs with the user form and its existing confirmation. The organization editor replaces only the selected node's member set, so memberships in other nodes survive batch edits. Root administrators manage node-wide membership; other administrators can only change affiliations of users below their authorization level. Validating records and replacing associations share one transaction; successful node-wide operations are logged. The knowledge library derives personnel departments from the same tree memberships instead of the legacy free-text field. The tree displays direct users under each node, toggles on row clicks, and scrolls independently from the detail card. Node deletion also rejects live member references.

Keep a separate `government_organization_nodes` adjacency tree with administrator-defined names, optional types, parent IDs and sibling order. User Permissions exposes tree creation, editing and deletion to the built-in super-administrator, while other administrators can read it. Node writes reject missing parents and ancestry cycles; deletion requires a leaf with no role references. Roles store selected node IDs in `permissions.organization_node_ids`; writes validate those references. The tree starts empty rather than implying a particular jurisdiction. Empty lists serialize as `[]`, because `null` would violate the shared tree/role-picker response validation. Read failures retain an inline retry state instead of presenting an empty tree or allowing edits against unknown data.

## Alternatives considered

**Fixed province/city/agency columns** would fail for customers with additional or fewer layers and would encode one organizational template into the schema.

**Reuse billable organizations or their departments** would join public-sector affiliation to enterprise account transfer, billing and quota behavior. The two structures remain separate.

**Apply organization selection as an authorization filter immediately** would silently change user and data access without a defined member assignment or inheritance policy. This release stores the relationship for administration only.

## Consequences

Different branches can have different depths and node types. A role can refer to multiple nodes, but those references do not yet restrict data, model access or user visibility. Operators must remove child nodes and role references before deleting a parent. Backend startup creates the new table through its existing migration path; production rollout requires the updated backend and frontend together.

## Testing

Gin requests with an isolated database exercise creation, cycles, missing parents, role references and editor privileges. React tests exercise role selection and persistence alongside model permissions.
