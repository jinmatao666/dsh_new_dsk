# Expert website independence

Each direct child of `expert-web/` is a standalone expert website and task service. It may share deployment infrastructure with another expert but must build, test, and deploy from its own directory after being copied to a separate repository.

- Keep each project's frontend, backend, lockfile, migrations, tests, deployment files, environment example, and README inside that project's directory.
- Do not import source or configuration from the DSH repository root, `packages/`, `products/`, the OneAPI server, or another expert directory. Do not add `expert-web/*` to the DSH pnpm workspace, root TypeScript programs, bundle, or build.
- Integrate with the platform only through versioned HTTP identity endpoints and the documented desktop bridge. A shared SDK must be separately published and version-pinned, never linked through a relative path.
- Treat the desktop bridge as privileged. Ship a restrictive CSP that blocks unreviewed iframes and third-party scripts; avoid remote embeds in the privileged workbench. Review redirects and every deployed origin before publishing the expert.
- Keep expert-specific tasks, history, progress, files, and results in that expert's own service. Do not move expert business logic into DSH or the OneAPI directory service.
- Use the corresponding legacy expert workbench as the visual and interaction reference. Reuse eligible icons, backgrounds, and other assets by placing copies inside the expert project; never load them from the legacy or DSH repository at build time or runtime. Verify initial, active, error, and result states against reference screenshots, and record any intentional difference.
- Before declaring an expert portable, copy only its directory to a clean location and run its documented install, test, build, and deployment checks there.
