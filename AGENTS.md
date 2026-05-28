# Minutia Agent Notes

## Repo Boundaries

- Core product code and generic self-host support live in this repo.
- OSS self-host is a single-workspace model: one organization per instance, with workspace invitations for additional users.
- Hosted VPS deployment automation lives in the private sibling repo `minutia-ops`.
- Private hosted billing and control-plane work lives in the private sibling repo `minutia-cloud`.
- Cloud multi-tenant provisioning and super-admin organization creation live in `minutia-cloud`, not this OSS repo.
- Do not add VPS-specific deployment overlays, private runtime topology, domains, hostnames, SSH details, provider details, or incident runbooks to this OSS repo.
- Do not add tenant provisioning, organization switching, cloud super-admin UI, or hosted lifecycle code to this OSS repo.
- Keep generic self-host files public and provider-neutral unless explicitly asked otherwise.

## Guardrails

- Preserve core app behavior and generic self-host behavior when removing hosted/VPS surfaces.
- Prefer small, test-backed changes.
- Run targeted scans before committing OSS changes.
