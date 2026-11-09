# Agent Note: Feature-page address dialog must leave the settings form

Status: implemented

English | [中文](2026-11-09-feature-page-address-dialog-form-trap.zh.md)

## Problem

Workbench Feature Settings → land-market / policy-encyclopedia address dialog sat inside the deployment `<form>`. Enter submitted the outer form without applying the URL draft, so reopen still showed the previous address. Backdrop click-to-close also dismissed the dialog when IME candidate windows were chosen over the mask.

## Decision

Portal `FeaturePageAddressDialog` to `document.body` with z-index above the admin shell. Drop backdrop dismiss; Enter confirms the draft (ignoring IME composition); Escape closes; outer form `save` no-ops while the dialog is open. Credential status errors stay in-dialog so a 401 AxiosError is never passed to `showError` (which redirects to login).

## Alternatives considered

**Keep the dialog in the form and only `preventDefault` Enter on the input:** Rejected because IME and accidental outer submit paths remain, and the mask still competes with the shell stacking context.

**Persist to `/api/option/` from 确定 alone:** Rejected so Feature Settings keeps one Save for the whole deployment payload, matching knowledge-quota dialogs.

## Consequences

Operators still must click page-footer 保存设置 after 确定. Knowledge-quota dialogs keep their in-form placement until a similar report appears.
