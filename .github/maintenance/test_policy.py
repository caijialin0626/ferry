"""Exercise the issue controller with deterministic model replies and a real Git index."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import issue


class IssuePolicy(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.addCleanup(os.chdir, os.getcwd())
        os.chdir(tmp.name)
        self.root = Path.cwd()
        os.mkdir("src")
        os.makedirs(".github/workflows")
        Path("README.md").write_text("Example project\n")
        Path("src/sample.mjs").write_text("export const limit = 1;\n")
        Path(".github/workflows/trusted.yml").write_text("# trusted workflow\n")
        for args in (["init", "-q"], ["add", "."], ["-c", "user.email=tests@example.org",
                     "-c", "user.name=Test", "commit", "-qm", "base"]):
            subprocess.run(["git", *args], check=True)
        self.ticket = {"title": "Raise the sample limit", "body": "Use 2."}
        self.outputs = self.root / "outputs"
        self.start(patch.dict(os.environ, ISSUE="42", GITHUB_OUTPUT=str(self.outputs),
                              FINGERPRINT=issue.fingerprint(self.ticket)))
        self.start(patch.object(issue, "WORK", self.root))
        self.start(patch.object(issue, "issue", return_value=self.ticket.copy()))
        self.notify = self.start(patch.object(issue, "notify"))

    def start(self, context):
        item = context.start()
        self.addCleanup(context.stop)
        return item

    def test_spam_is_silent(self):
        with patch.object(issue, "ask", return_value={"decision": "ignore"}) as model:
            issue.develop()
        self.assertEqual(model.call_count, 1)
        self.notify.assert_not_called()
        self.assertFalse(self.outputs.exists())

    def test_review_controls_release_independently_of_candidate(self):
        replies = [{"decision": "develop", "acceptance": "limit is 2", "files": ["src/sample.mjs"]},
                   {"edits": [{"path": "src/sample.mjs", "before": "= 1", "after": "= 2"}]},
                   {"approved": False}]
        with patch.object(issue, "ask", side_effect=replies):
            issue.develop()
        self.assertIn("approved=no", self.outputs.read_text())
        self.assertTrue((self.root / "ferry.patch").is_file())
        issue.validate()

    def test_publisher_rejects_protected_files_and_links(self):
        workflow = ".github/workflows/trusted.yml"
        Path(workflow).write_text("# unrelated change\n")
        subprocess.run(["git", "add", workflow], check=True)
        with self.assertRaises(ValueError):
            issue.validate()
        subprocess.run(["git", "reset", "-q", "HEAD"], check=True)
        Path("src/link.mjs").symlink_to("../" + workflow)
        subprocess.run(["git", "add", "src/link.mjs"], check=True)
        with self.assertRaises(ValueError):
            issue.validate()

    def test_stale_seed_dispatches_fresh_run(self):
        api = self.start(patch.object(issue, "api", side_effect=[
            {"updated_at": "2026-01-01T00:01:00Z"}, {"created_at": "2026-01-01T00:00:00Z"}, None]))
        with patch.dict(os.environ, WRITER="test-writer", GH_TOKEN="test-job", BRANCH="main", MODE="issue"), patch.object(issue.time, "sleep"):
            issue.freshness()
            self.assertEqual(os.environ["GH_TOKEN"], "test-job")
        self.assertEqual(api.call_args.args[1]["inputs"], {"issue": "42", "mode": "issue"})
        self.assertFalse(self.outputs.exists())


if __name__ == "__main__":
    unittest.main()
