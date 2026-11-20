# React Template

English | [中文](README.zh.md)

Channel discovery is optional: a channel can be saved with an empty model list. After selecting a source channel, the model definition form accepts a manually entered model ID as well as suggestions from the saved list. Saving associates that ID with the selected channel; upstream availability is verified separately by connectivity tests.

## Basic Usages

```shell
# Runs the app in the development mode
npm start

# Builds the app for production to the `build` folder
npm run build
```

If you want to change the default server, please set `REACT_APP_SERVER` environment variables before build,
for example: `REACT_APP_SERVER=http://your.domain.com`.

Before you start editing, make sure your `Actions on Save` options have `Optimize imports` & `Run Prettier` enabled.

In the operations edition, System Settings → Features → Knowledge Bases → Knowledge credit settings saves the platform percentage and maximum per-file browse, Q&A and download prices for subsequent subscription-library settlements. The default maximum for each action is 10 credits. Lowering a limit caps existing prices on future charges. The dialog calculates the remaining share for the maintainer from the entered percentage.

## Reference

### Public knowledge base files

Public-library file lists include the recorded uploader. Administrators can return a file to one of that uploader's unpublished personal libraries, selecting the destination when multiple libraries exist. The server validates uploader ownership, applies the personal storage quota, keeps both files under distinct names on a name conflict, and removes the public source after the target upload succeeds. Files without a recorded uploader hide the return action. An uploader with no unpublished personal library must create one first. The destination request times out after 15 seconds and displays failures in the return dialog.

### Personal knowledge base files

When a selected person has no personal library, administrators see a Create Knowledge Base action in that person's file list. The request names the selected owner, and the server requires the administrator workbench route, validates the person and checks again inside the creation transaction that their personal catalog is empty. The library remains private and its creation log records the selected owner separately from the administrator who created it. The client verifies returned ownership and adds the created library to the catalog so the person’s count updates immediately. Existing personal libraries hide this action.

In Knowledge Base → Personal Knowledge Base, selecting a person with multiple libraries opens a searchable, paginated library catalog using the public-library cards and statistics. On wide screens, the back control, person title, library count and search share one compact toolbar; narrow screens wrap the search below. Each card opens that library's file list. The file-list toolbar keeps the back control, title, compact search and rightmost upload action together on wide screens; the upload explanation is omitted. Returning restores the catalog search and page. Library owners and root administrators can upload and retry failed parses inside the selected library. A person with one library keeps the direct file-list view. Personal-library menus support editing and deletion with the existing permissions.

### Knowledge category creation

Only administrators and root administrators see the create-category action. The creation API rejects ordinary users with HTTP 403.

### Knowledge review inbox

Open a review to see the applicant and library in **Application details**. The **All files** tab shows parse status, and selecting a file opens its preview. Pagination appears when the files span multiple pages.

The Knowledge page gives administrators a blue inbox entry with a white icon and pending count; the catalog has no extra reminder banner. Publication and subscription tasks have separate tabs and pending, approved and rejected filters. The publication review dialog displays the requested public/subscription scope and owner note. Rejection requires a reason. Only administrators may list or settle either queue. Publication review changes visibility only in the operations edition; subscription review grants access independently. Each library retains its latest publication request; resubmitting a rejected request replaces that request’s review state.

### Administrator user editing

Save User opens a password confirmation dialog after editing. Cancel keeps edits without submitting; failed saves keep edits and clear the confirmation password. Display names are written to the account-center profile, and missing mappings or write failures return errors. Other fields may already be saved when a subsequent profile write fails.

Administrator and self-service username changes update the authoritative login identifier; duplicate identifiers are rejected. Password, profile and binding failures return errors rather than success. Email password resets use account-center email identifiers and product mappings. A failed multi-field save can leave earlier fields saved; it does not provide cross-database rollback.

### Skill package imports

The skill metadata editor stores optional multiline usage examples in `usage_example`. Saving an empty string clears them. The skill API and administrator browse drawer return/display the same text; matching desktop versions show it below the description without reinstalling the skill package. The `skills.usage_example` text column is created by the existing startup AutoMigrate for `Skill`. This field does not change executable instructions or attachments.

Publishing, republishing and rolling back an imported release preserve administrator-edited display names, icons, categories, descriptions, scenarios and tags, including category relations. These actions replace release content, assets, version and availability only. Importing a new package or approving a personal submission remains a separate metadata update; already overwritten catalogue text is not automatically restored.

Administrators can select multiple ZIP files (one skill per ZIP), a single skill folder, or a parent folder whose immediate child folders each contain a skill. Only a root `SKILL.md` is required; `manifest.json` is optional and the server normalizes it. Folder assets retain their relative paths and binary contents. Imports run sequentially with progress and individual success/error results; one failed package does not stop later packages. Successful imports leave the skill offline, including imports of a new version for an existing published skill; publication requires an administrator action. Duplicate-version rejection does not unpublish a skill. Keep the page open until completion and retry only failed entries; existing skill/version conflicts remain server errors. A ZIP containing multiple skills is not a batch container. List actions retain the selected page; search or scope changes reset to page one, and removing the last page clamps to the last available page.

### Skill batch management

Batch Management enables cross-page selection, select-current-page, publication, unpublication and deletion with confirmation. Search or source changes clear selection. Private skills support deletion only. Operations reuse the existing permission-checked APIs sequentially; each result is displayed, failures do not stop later items, and successful selections are cleared. There is no rollback or automatic retry. Keep the page open until completion. Public deletion uses the existing soft-delete behavior and does not remove desktop-local installations. Published skills are skipped during batch publication, including those with pending updates; publish updates from version management.

### Desktop feature visibility

System Settings retries transient read failures twice and offers an in-page reload after failure. Authentication, permission and invalid-configuration errors are displayed without automatic retries. Failed loads never expose a default-value save form; requests are cancelled when leaving the page. Automatic retries apply only to reads, not saves.

Root administrators configure automation, connector, knowledge-base, land-market, planning-lecture and policy-encyclopedia entries in System Settings → Feature Settings. Internet and intranet have independent switches stored in the existing `SystemDeploymentSettings` option. Defaults enable automation and knowledge bases in both environments and connectors only on Internet; land market, planning lecture and policy encyclopedia default to off. On the same page, Address Configuration beside land market, planning lecture and policy encyclopedia stores http(s) page URLs (empty allowed), independently of the visibility switches. The public `/api/desktop-config` endpoint returns both allowlisted visibility settings and page URLs. Updated desktops hide disabled entries without placeholders and keep Settings anchored at the bottom; startup, login and existing authentication refreshes apply changes. Enabling an intranet entry does not bypass outbound network restrictions or implement real connector authorization or scheduling. No additional database table is required.

### Desktop plugin permissions

System Settings → Plugin settings stores the global browser-assistant permission in `SystemDeploymentSettings.plugins.browserAssistant`. It defaults to enabled when omitted. Only root administrators can save it. `/api/desktop-config` publishes the validated boolean; matching desktop releases combine it with the personal switch and existing network restrictions. Startup, login, focus and authentication refresh apply changes without forcibly terminating running operations. Older desktop releases require an update to enforce the permission. No additional database table is required.

1. https://github.com/OIerDb-ng/OIerDb
2. https://github.com/cornflourblue/react-hooks-redux-registration-login-example

### User activity profiles

Selecting a user row opens the observed-activity profile. The dialog keeps its title and close control visible while scrolling; composition and trends share a row on wide screens and stack on narrow screens. Charts cover both endpoints of the returned Beijing date window. Recorded installations count unique user/skill pairs independently from repeatable download events; the profile does not infer an installation conversion rate. Installed skills appear in two columns, ordered by per-skill download count, with ten shown initially and an option to expand all. A historical installation without a download count displays one download in that list; the cumulative download metric still counts observed download events only.

The organization tree and role organization picker use the same array response; see [organization management](../../docs/role-management.md). A failed tree read displays an inline retry state rather than a zero-node count.

## Runtime deployment

Production builds are relocatable. Public paths, API prefixes, canonical URLs and proxy trust are container runtime configuration; see [generic backend delivery](../../deploy/README.md).

The login and registration page uses one SMS login switch; saving it synchronizes the SMS service and phone login options. The SMS signature stays server-configured and is hidden from this form.

The knowledge workbench places a muted activity-log button at the far right of its header actions, combining library creation, review outcomes, deletions and file transfers in time order. Search and refresh sit to the right of the title. Search matches library, source library, file and user names across all pages. Each operation shows its operator, or its reviewer for publication and subscription reviews. Related people identify the library creator and, when recorded, the applicant. Root can read all records; other administrators can read records they acted on or whose library they own. Events accumulate after deployment; existing operations are not reconstructed.

Deletion history retains library and file names after removal. Deleting a category records the category and each deleted library. Failed remote deletions do not produce success events.
