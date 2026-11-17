// Round-trips every scenario fixture through the prompt builder so the
// fixtures cannot rot against the prompt or the server-side cutoffs.
import * as fs from 'fs';
import * as path from 'path';
import { buildUserMessage } from './promptBuilder';
import { fieldShape } from './buildPromptInputs';
import { RequestContext, RideLine } from './promptInputs';

interface Fixture { id: string; context: RequestContext; rides: RideLine[] }

const DIR = path.join(__dirname, 'fixtures');
const files = fs.readdirSync(DIR).filter(f => /^S.*\.json$/.test(f)).sort();
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe('scenario fixtures', () => {
  it('finds the scenario files', () => {
    expect(files.length).toBeGreaterThanOrEqual(14);
  });

  describe.each(files)('%s', file => {
    const fx: Fixture = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));

    it('renders every ride code and name and no UUID', () => {
      const msg = buildUserMessage(fx.context, fx.rides);
      for (const r of fx.rides) expect(msg).toContain(`\n${r.code} ${r.name} |`);
      expect(msg).not.toMatch(UUID_RE);
      expect(msg).toContain(`up to ${fx.context.batchSize} recommendations`);
    });

    it('has context.field matching fieldShape() of its rides', () => {
      expect(fx.context.field).toBe(fieldShape(fx.rides));
    });

    it('has an anchor that matches its isAnchor ride', () => {
      const anchors = fx.rides.filter(r => r.isAnchor);
      if (fx.context.anchor === null) {
        expect(anchors).toHaveLength(0);
      } else {
        expect(anchors.map(r => ({ code: r.code, name: r.name }))).toEqual([fx.context.anchor]);
      }
    });
  });
});
