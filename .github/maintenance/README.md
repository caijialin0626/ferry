# Ferry issue maintenance

[Ferry issue maintainer](../workflows/ferry-issues.yml) runs on GitHub-hosted runners. An opened issue starts a bounded Codex triage. Spam and unrelated requests receive no comment. An actionable request starts development, and the issue receives progress, PR and release updates. The bot replies to unclear reports with a request for details.

## One-time setup

Enable Actions and allow workflows to create pull requests in the repository's Actions settings. The workflow grants permissions per job. Automatic release fast-forwards the exact tested commit using a normal, non-forced push. Branch protection can reject this operation and leave the PR for review.

Create two **repository Actions secrets**:

- `CODEX_SECRET_WRITER` is a fine-grained GitHub token for this repository with **Secrets: read and write**. Choose an expiration and rotate it when needed. It can update any Actions secret in this repository. The Codex container never receives it.
- `CODEX_AUTH_JSON` is a dedicated file-backed ChatGPT login, including its refresh token. Obtain it on a trusted machine. Use a separate session for CI so your desktop and the runner do not rotate the same refresh token.

With the repository cloned, this command starts a separate login and uploads its result through standard input. It deletes the local bootstrap copy when the shell exits.

```sh
(
  set -eu
  umask 077
  session_dir=$(mktemp -d)
  trap 'rm -rf "$session_dir"' EXIT
  CODEX_HOME="$session_dir" codex -c 'cli_auth_credentials_store="file"' login
  jq -e '.tokens.refresh_token | type == "string" and length > 0' "$session_dir/auth.json" >/dev/null
  gh secret set CODEX_AUTH_JSON < "$session_dir/auth.json"
)
```

Keep this workflow on a trusted default branch. Repository writers can change workflows that use repository secrets. Restrict write access accordingly.

## Run and recover

Use **Actions → Ferry issue maintainer → Run workflow** on the default branch:

| Mode | Behavior |
| --- | --- |
| `issue` | Process the specified open issue again, for example after the author clarifies the report or the target branch moves. |
| `refresh` | Run a small Codex request and persist the current login if Codex rotates it. Also runs weekly. |
| `verify` | Run the release gate against the current default branch without a model credential, PR or merge. |

The workflow serializes use of the login. GitHub snapshots repository secrets when it queues a run. A run queued before the last rotation dispatches a fresh run. An expired or revoked login needs a new bootstrap. Fix a failed write-back before retrying. Credentials stay out of logs, caches, artifacts and the checkout. See the [Codex CI authentication guide](https://learn.chatgpt.com/docs/auth/ci-cd-auth).

## Release criteria

- Automatic intake processes the first 20 issues opened per UTC day, with a maximum of three per author. Later issues remain open for maintainer dispatch. Manual dispatch can also process older reports. GitHub's concurrency queue holds up to 100 waiting runs.
- Codex selects at most eight source, documentation or test files, produces exact text edits, and independently reviews the resulting diff against the issue. Workflow files, dependency manifests, binary assets and deployment configuration are outside the automatic edit set. Requests outside it remain for maintainers.
- The proposal job validates paths and file modes separately. The test job installs locked dependencies, then runs syntax checks, the integration suite and Chromium end-to-end tests with a simulated external CLI. The real browser signs in to Ferry, sends a message, receives a reply and checks history after reload.
- Test execution has no model or publishing credential, no external network, and a read-only source tree. A failed test or review leaves the PR open. Before release, the workflow rechecks the issue text, PR state, head SHA and parent commit. A concurrent default-branch update makes the fast-forward fail instead of releasing an untested combination.
