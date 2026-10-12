"""python3 -m unittest test_own  (from tools/loadouts; reads no network and writes nothing)."""
import json, os, tempfile, unittest
import own

GUNS = json.load(open(os.path.join(own.HERE, 'guns.json')))
CFG = json.load(open(os.path.join(own.HERE, 'creators.json')))


class Collect(unittest.TestCase):
    def setUp(self):
        self.raw, own.RAW = own.RAW, tempfile.mkdtemp() + os.sep

    def tearDown(self):
        own.RAW = self.raw

    def test_a_creator_whose_page_gave_nothing_keeps_the_last_builds(self):
        cid = CFG[0]['id']
        old = {'builds': [dict(weapon='M4A1', mode='ops', creator=cid, code='X1', added=None, note='', tags=[], pos=0)],
               'creators': {cid: dict(name='N', links=['https://example.org'])}}
        _, creators, builds, skipped = own.collect(GUNS, old)
        self.assertEqual([b['code'] for b in builds], ['X1'])
        self.assertEqual(creators[cid]['links'], ['https://example.org'])
        self.assertEqual(skipped['kept from the last run: ' + cid], 1)

    def test_a_page_the_parser_chokes_on_does_not_stop_the_rest(self):
        for c in CFG: open(own.RAW + c['id'] + '.' + c['ext'], 'w').write('\x00 not a page')
        bad = CFG[0]['parser']
        real, own.PARSER[bad] = own.PARSER[bad], lambda *a: 1 / 0
        try: _, _, builds, skipped = own.collect(GUNS)
        finally: own.PARSER[bad] = real
        self.assertEqual(builds, [])
        self.assertTrue(any(k.startswith('parser failed: ' + CFG[0]['id']) for k in skipped))


if __name__ == '__main__':
    unittest.main()
