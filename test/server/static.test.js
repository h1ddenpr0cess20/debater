import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { createStaticMiddleware } from '../../src/server/static.js';
import { withServer } from '../helpers/request.js';

describe('static hosting', () => {
  let middleware;
  let root;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'debater-dist-'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<!DOCTYPE html><title>debater</title>');
    await writeFile(join(root, 'assets', 'index-abc123.css'), 'body{}');
    await writeFile(join(root, 'a lectern.svg'), '<svg/>');
    await writeFile(join(root, 'EGG.PNG'), 'png');
    middleware = createStaticMiddleware(root);
  });

  it('serves the entry document at the root', async () => {
    await withServer(middleware, async (request) => {
      const { status, headers, body } = await request('/');
      assert.equal(status, 200);
      assert.match(headers.get('content-type'), /text\/html/);
      assert.match(body, /debater/);
    });
  });

  it('types a file by its extension whatever case it is in', async () => {
    await withServer(middleware, async (request) => {
      const { headers } = await request('/EGG.PNG');
      assert.match(headers.get('content-type'), /image\/png/);
    });
  });

  it('decodes the escapes a browser puts in the path', async () => {
    await withServer(middleware, async (request) => {
      const { status, body } = await request('/a%20lectern.svg');
      assert.equal(status, 200);
      assert.equal(body, '<svg/>');
    });
  });

  it('refuses to walk out of the build directory through an escape either', async () => {
    await withServer(middleware, async (request) => {
      const { body } = await request('/%2e%2e%2f%2e%2e%2fetc%2fpasswd');
      assert.match(body, /debater/, 'anything outside the root falls back to the entry document');
    });
  });

  it('answers a malformed escape rather than throwing on it', async () => {
    await withServer(middleware, async (request) => {
      const { status } = await request('/%zz.css');
      assert.equal(status, 404);
    });
  });

  it('pins fingerprinted assets and leaves everything else revalidating', async () => {
    await withServer(middleware, async (request) => {
      const asset = await request('/assets/index-abc123.css');
      assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.match(asset.headers.get('content-type'), /text\/css/);

      const page = await request('/index.html');
      assert.equal(page.headers.get('cache-control'), 'no-cache');
    });
  });

  it('falls back to the entry document for extensionless paths', async () => {
    await withServer(middleware, async (request) => {
      const { status, body } = await request('/some/deep/link');
      assert.equal(status, 200);
      assert.match(body, /debater/);
    });
  });

  it('does not invent a fallback for a missing asset', async () => {
    await withServer(middleware, async (request) => {
      assert.equal((await request('/assets/gone.js')).status, 404);
    });
  });

  it('refuses to walk out of the build directory', async () => {
    await withServer(middleware, async (request) => {
      for (const path of ['/../package.json', '/..%2Fpackage.json', '/assets/../../package.json']) {
        const { status, body } = await request(path);
        assert.equal(status, 404, `${path} should not escape the root`);
        assert.ok(!String(body).includes('"name": "debater"'), `${path} leaked a file`);
      }
    });
  });

  it('answers HEAD with the headers but no body', async () => {
    await withServer(middleware, async (request) => {
      const { status, headers, body } = await request('/', { method: 'HEAD' });
      assert.equal(status, 200);
      assert.ok(Number(headers.get('content-length')) > 0);
      assert.equal(body, '');
    });
  });

  it('leaves non-GET verbs to the rest of the chain', async () => {
    const sentinel = (req, res) => res.writeHead(405).end();
    await withServer([middleware, sentinel], async (request) => {
      assert.equal((await request('/', { method: 'DELETE' })).status, 405);
    });
  });
});
