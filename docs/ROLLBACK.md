# Putting an earlier version of the website back (rollback)

If a release breaks something, the previous version can be put back on the website from GitHub, without changing any code. The next normal merge to main deploys the newest version again.

## Release tags

Every time main is deployed, the "Build and deploy site" workflow tags the deployed commit `v<version>`, using the version in `web/package.json` (for example `v0.6.13`), if that tag doesn't exist yet. So each tag marks **the first deploy of that version number**. A later merge that keeps the same version number doesn't move the tag. The tags are listed under **Code → Tags** in the repository (or `git tag`).

Releases deployed before this was added have no tag. The first tag appears with the first deploy of main after the hardening build is merged.

## How to roll back

1. Open the repository on GitHub and click the **Actions** tab.
2. In the list on the left, click **Build and deploy site**.
3. Click **Run workflow** (on the right, above the list of runs).
4. Leave **Use workflow from** on **main**.
5. In **Roll back the website**, type the release tag to put back, for example `v0.6.12`.
6. Click the green **Run workflow** button.

What happens:
- The workflow builds that tag's code (with its own lock file, so the same packages), fetches the AI models that release pinned (its own `web/models/manifest.json`), and deploys it to GitHub Pages. Lint and tests aren't run again (that release passed them when it was first deployed), so it takes a few minutes.
- The run's summary says which version and commit were deployed, and warns if main's library format is newer than the release's (see below).
- People with LightBench open, and the installed app, get a notice offering the earlier version with a **Reload** button, the same way they get updates. Nothing changes for them until they click it, or until every LightBench tab and window has been closed (the browser then switches by itself, as it does for any update).

## Going forward again

Merge to main as usual (or run **Build and deploy site** with **Roll back the website** left empty). The newest version is deployed, and open copies offer it as an update with its release notes.

## Before you roll back

- **Library format.** When a release changes how the library is stored (the catalog schema), earlier versions can't open a library that the newer version has already opened. They show "This library was saved by a newer version of LightBench" and change nothing; the library opens again as soon as the newer version is back. The rollback run warns when this applies.
- **Edits made with the newer version.** An earlier version keeps a newer tool's settings that it doesn't know, and a newer kind of mask, without drawing them, and draws an edit made with a newer rendering version with the newest rendering it knows. So such photos can look different while the earlier version is deployed, and look as before once the newer version is back. Whether every newer setting survives being *changed* in the earlier version was not checked one by one, so it is safest not to edit those photos until the newer version is back.
- **AI models.** The rolled-back release uses the models its own manifest pins. A model that a newer release added isn't on the site while the earlier version is deployed.

## What was checked, and what wasn't

The workflow file was checked with `actionlint` (no errors; its shell checks were skipped because `shellcheck` isn't installed on the build machine) and each script was parsed with `bash -n`. **It has not run on GitHub yet:** the first real tag and the first real rollback are the test. The installed app's notice for an earlier version is covered by unit tests (`web/src/pwa/pwa.test.ts`), not by a real rollback on the live site.
