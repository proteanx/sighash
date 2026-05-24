# Changesets

This directory contains pending changesets that will become the next changelog entries.

To add a new changeset:

```bash
pnpm changeset
```

The CLI will ask which packages changed and what severity bump (patch / minor / major). Commit the resulting `.md` file with your PR.

See the [changesets docs](https://github.com/changesets/changesets) for details.
