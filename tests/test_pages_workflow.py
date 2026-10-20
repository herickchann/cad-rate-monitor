"""Guard the GitHub Pages republish schedule used for rate monitoring."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github' / 'workflows' / 'pages.yml'


class PagesWorkflowTests(unittest.TestCase):
    def test_daytime_schedule_every_thirty_minutes_vancouver(self):
        text = WORKFLOW.read_text()
        self.assertIn("cron: '*/30 9-17 * * *'", text)
        self.assertIn('timezone: America/Vancouver', text)
        self.assertIn('python build_site.py', text)


if __name__ == '__main__':
    unittest.main()
