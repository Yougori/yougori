# Development and releases

Publish work to `staging` first. Test it there, then merge a reviewed pull request
from `staging` into `main` when that version is ready. Keep `main` as the stable
source branch. Merging source does not publish installers or update the website.

## Work on staging

```sh
git switch staging
git pull --ff-only origin staging
```

Make the changes, review `git diff`, and commit only the files you intend to
publish. Push those commits with:

```sh
git push origin staging
```

For a new checkout, use `git clone --branch staging https://github.com/Yougori/yougori.git`.
See the [source setup guide](docs/source-checkout.md) for build prerequisites.

## Test before promoting

Run the checks relevant to the changes on the latest `staging` commit. For the
Windows desktop, the core local checks are:

```sh
npm ci
npm run verify
npm run test:e2e
npm run release:check
```

All GitHub Actions workflows are manual. Pushing a branch or opening a pull
request does not start Windows, guest-agent, Linux or macOS checks. To request
a Windows CI run explicitly, select **Actions > Verify > Run workflow** and
choose the `staging` branch, or use:

```sh
gh workflow run verify.yml --ref staging
```

Run the other platform workflows separately when needed. Record the tested
commit and results in the pull request. New commits need checks appropriate to
their changes before promotion. Complete the relevant packaged and real-machine
checks in [release readiness](docs/release-readiness.md) before publishing a release.

## Promote tested changes

Keep a draft pull request with `main` as the base and `staging` as the head while
testing. Mark it ready once the tested version is approved, then use **Create a
merge commit** to preserve the shared history of these long-lived branches.
Keep `staging` after merging. Update the local branches before the next batch:

```sh
git switch main
git pull --ff-only origin main
git switch staging
git merge --ff-only main
git push origin staging
```

If `main` has diverged, merge `origin/main` into `staging`, resolve any conflicts
there, and test the result before promotion. Do not force-push either branch.
Building installers and publishing a GitHub release or website download remain
separate release steps.
