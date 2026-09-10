# Public release preparation

The project name is `fx-devkit`, the target npm package is `@angelmsger/fx`,
and the binary name is `fx`.
This checkout is a source baseline, not evidence of a published package.

## Distribution target

Publish `@angelmsger/fx` on public npm with public access. Installing fx must not
require a private registry, a team account or a manifest checkout. Access to a
team's manifest and connected services remains subject to that team's controls.

## Configured publication coordinates

Following the maintained `oa-cli` package convention, the project uses these
inferred public coordinates:

- Repository: [AngelMsger/fx-devkit](https://github.com/AngelMsger/fx-devkit).
- Website: [fx-devkit](https://angelmsger.github.io/fx-devkit/).
- Issues: [GitHub Issues](https://github.com/AngelMsger/fx-devkit/issues).
- Package access: `public`; license: [Apache-2.0](../LICENSE).

These are the configured publication destinations, not evidence that the remote,
website or npm release already exists. The website source lives in `docs/website/`.
README links use the public documentation destinations so npm readers do not need
the source tree. The site build resolves its own public links locally and keeps
the selected language.

## Remaining implementation and release decisions

- Migrate the shared registry policy, runtime metadata lookup, self-update,
  publishing wrapper/guard and their tests together. They currently reject public
  npm or require a private coordinate; see the
  [registry transition](design/registry-configuration.md) for exact locations.
- Verify the configured repository, website and issue-tracker destinations when
  provisioning the public repository. Verify package name, version and access to
  the `@angelmsger` scope before publication.
- Review third-party notices for the actual distribution. Apache-2.0 is selected
  and its full license text is included in the package.
- The static website has a GitHub Pages workflow, independent of npm publication.
  Configure package CI so ordinary checks do not require private credentials or a
  private manifest. The current Jenkinsfile binds `npm-token` for the entire
  pipeline and publishes on `v*` tags; adapt package authentication and tag behavior
  to the chosen release host before enabling npm publication.
- Verify the inferred public links after deploying the repository and website.
  The npm package intentionally omits the documentation source and site toolchain;
  README links point to the public site or source repository instead.
- Preserve separate private integration checks and explicit native Windows
  acceptance limits. Do not present offline tests as native-host evidence.

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
