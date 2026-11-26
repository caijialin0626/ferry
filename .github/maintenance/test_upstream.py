import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import upstream


def row(n, **overrides):
    return {"tagName": f"v2.1.{n}", "isDraft": False, "isPrerelease": False, **overrides}


class UpstreamTest(unittest.TestCase):
    def test_bootstrap_and_unchanged(self):
        def no_pages():
            raise AssertionError("release history should not be fetched")
            yield

        self.assertEqual(upstream.pending("codex", "", "rust-v0.172.0", no_pages()), ["rust-v0.172.0"])
        self.assertEqual(upstream.pending("agy", "1.5.16", "1.5.16", no_pages()), [])

    def test_catch_up_in_order_without_skipping_intermediate_versions(self):
        pages = [[row(12), row(11, isDraft=True), row(10), row(9, isPrerelease=True)],
                 [row(n) for n in range(8, 1, -1)]]
        self.assertEqual(upstream.pending("claude", "v2.1.3", "v2.1.12", pages),
                         ["v2.1.4", "v2.1.5", "v2.1.6", "v2.1.7"])
        self.assertEqual(upstream.pending("claude", "v2.1.7", "v2.1.12", pages),
                         ["v2.1.8", "v2.1.10", "v2.1.12"])

    def test_assess_routes_and_reuses_tickets(self):
        release = json.dumps({"tag_name": "1.5.16", "prerelease": False, "draft": False, "body": "Notes"})
        ticket = {"number": 12, "state": "open", "body": "<!-- ferry:adapt -->\nfix"}
        for decision, existing, calls in [("covered", None, []), ("review", None, ["issues"]),
                ("adapt", None, ["issues", "actions/workflows/ferry-proposals.yml/dispatches"]),
                ("adapt", ticket, ["actions/workflows/ferry-proposals.yml/dispatches"])]:
            with self.subTest(decision=decision, retry=bool(existing)), tempfile.TemporaryDirectory() as tmp, \
                    patch.dict(os.environ, BRANCH="main", GITHUB_OUTPUT=tmp+"/outputs", GITHUB_STEP_SUMMARY=tmp+"/summary"), \
                    patch.object(upstream, "command", return_value=release), \
                    patch.object(upstream, "existing_issue", return_value=existing), \
                    patch.object(upstream, "ask", return_value={"decision": decision, "summary": "Model catalog"}), \
                    patch.object(upstream, "api", return_value=ticket) as api:
                upstream.assess("agy", ["1.5.16"])
                self.assertEqual([c.args[0] for c in api.call_args_list], calls)
                self.assertEqual(Path(tmp, "outputs").read_text(), "assessed=yes\n")

    def test_checkpoint_refuses_outdated_snapshot(self):
        with patch.object(upstream, "checkpoint", return_value=("v2.1.7", "sha")), \
                patch.dict(os.environ, PREVIOUS="v2.1.5"), patch.object(upstream, "api") as api:
            with self.assertRaisesRegex(ValueError, "moved"):
                upstream.record("claude", ["v2.1.6"])
            api.assert_not_called()


if __name__ == "__main__":
    unittest.main()
