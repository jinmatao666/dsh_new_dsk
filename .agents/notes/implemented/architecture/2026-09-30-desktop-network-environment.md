# Agent Note: Desktop network environment

Status: implemented

English | [中文](2026-09-30-desktop-network-environment.zh.md)

## Problem

Private-network deployments need internal login and model access without presenting public SkillHub, experts, connectors or search as usable. A visual-only choice cannot enforce restrictions or survive application restarts.

## Decision

The authentication Host owns durable `wanwei-network.mode`, initialized to Internet and updated from the backend under [server-owned login settings](2026-10-10-server-owned-login-settings.md). That decision partially supersedes local mode selection; this note retains ownership of restrictions and restoration. Client slot hooks share one observable mirror and synchronize native URL opening with committed policy. Administrator-configured login and model endpoints are not rewritten.

SkillHub RPC is rejected before upstream I/O. Installed SkillHub definitions are filtered by installation receipt, including cached reads. Generic availability/filter registration is the only change to official tool and skill registries. Public search is removed from all scopes; public web fetch is denied before execution. Experts and connectors have disabled entries; Host expert RPC is independently denied. Local uninstall remains available.

Captured link clicks and native new-window handling block public HTTP(S). The configured OneAPI origin, private literal addresses and local DNS names are internal. Classification does not resolve DNS; additional internal domains need explicit adaptation.

The unavailable SkillHub catalog uses a large, centered cloud-and-lock SVG illustration with a network explanation and a reminder that platform and local skills remain usable. The illustration is bundled inline and requires no network fetch. The placeholder has no enclosing border or card background; its illustration uses half opacity and its heading uses secondary text styling for a quieter unavailable state. Platform catalog no-results uses a skill-card-and-magnifier illustration with the same dimensions, muted styling and spacing, without changing filtering or upload empty states. Installed-skill management keeps its existing local removal controls instead of displaying this placeholder.

## Alternatives considered

**Visual disabling only:** unavailable buttons do not stop model execution or direct RPC.

**Global offline mode:** disabling every HTTP request breaks internal authentication, models and platform skills.

**Deleting installed skills:** deletion destroys installations needed after switching back; filtering retains files and local uninstall.

## Consequences

Internet mode restores filtered tools and skills. This is application policy, not a firewall or shell sandbox. Existing conversation instructions are not rewritten; switching environments requires a fresh conversation for clean context.

Tests cover restoration, cached skill rejection, persistence, link classification, search denial before I/O and installed SkillHub usability. Rust tests cover native link classification. Real internal service credentials and macOS native acceptance remain deployment verification tasks.
