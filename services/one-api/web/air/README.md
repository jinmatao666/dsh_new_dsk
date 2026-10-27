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

## Reference

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

Root administrators configure automation and connector entries in System Settings → Feature Settings. Internet and intranet have independent switches stored in the existing `SystemDeploymentSettings` option. Defaults enable automation in both environments and connectors only on Internet. The public `/api/desktop-config` endpoint returns allowlisted visibility settings. Updated desktops hide disabled entries without placeholders and keep Settings anchored at the bottom; startup, login and existing authentication refreshes apply changes. Enabling an intranet entry does not bypass outbound network restrictions or implement real connector authorization or scheduling. No additional database table is required.

### Desktop plugin permissions

System Settings → Plugin settings stores the global browser-assistant permission in `SystemDeploymentSettings.plugins.browserAssistant`. It defaults to enabled when omitted. Only root administrators can save it. `/api/desktop-config` publishes the validated boolean; matching desktop releases combine it with the personal switch and existing network restrictions. Startup, login, focus and authentication refresh apply changes without forcibly terminating running operations. Older desktop releases require an update to enforce the permission. No additional database table is required.

1. https://github.com/OIerDb-ng/OIerDb
2. https://github.com/cornflourblue/react-hooks-redux-registration-login-example

### User activity profiles

Selecting a user row opens the observed-activity profile. The dialog keeps its title and close control visible while scrolling; composition and trends share a row on wide screens and stack on narrow screens. Charts cover both endpoints of the returned Beijing date window. Recorded installations count unique user/skill pairs independently from repeatable download events; the profile does not infer an installation conversion rate.

The organization tree and role organization picker use the same array response; see [organization management](../../docs/role-management.md). A failed tree read displays an inline retry state rather than a zero-node count.
