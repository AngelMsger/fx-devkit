# Public release preparation

The repository name is `fx-devkit-next`. The CLI remains `fx`, and the package
identifier remains `@fx/devkit` until a distribution identity is selected.
This checkout is a source baseline, not evidence of a published package.

## Remaining release decisions

- Select the public repository owner and verify the destination before adding a remote.
- Confirm the copyright owner, choose a license and review third-party notices.
  `UNLICENSED` remains intentional until that decision is made.
- Confirm the package name and registry ownership. The existing publisher permits
  private registries only and package access remains restricted. Public npm
  distribution requires coordinated changes to publication, metadata lookup,
  self-update, tests and installation documentation; do not bypass the guard.
- Configure public CI without private credentials or a private manifest. Preserve
  separate private integration checks and explicit native Windows acceptance limits.

## Source and artifact review

Review all candidate files and paths, including tests, shell/Python scripts,
patches, symlinks and non-text assets. A package-only scan is insufficient.
Keep organization-specific detection dictionaries and raw findings privately;
review synthetic security fixtures rather than deleting meaningful test coverage.

Before publication, inspect every intended Git ref, commit message and author
identity. Do not merge or mirror private predecessor histories into this repository.
Migration revision mappings and original evidence remain in a private archive.

Build and run the checks in [validation](validation.md), inspect the actual npm
tarball (including source maps and implicit files), and verify installation from
that artifact in an isolated environment. Re-run publication checks after any
license, package metadata, registry or CI changes.

## Private data boundary

The manifest repository owns shared coordinates, people and team guidance.
Historical business patches, raw trial logs and investigation reports belong in
an appropriately restricted evidence store, not automatically in the manifest
that is distributed to team members. Credentials remain with their owning tools.
