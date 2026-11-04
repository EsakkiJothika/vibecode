const assert = require('node:assert/strict');
const { once } = require('node:events');
const { existsSync } = require('node:fs');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { BackendClient } = require('../dist-electron/main/backendClient.js');
const backendRoot = path.resolve(__dirname, '..', '..');
const virtualEnvironmentPython = path.join(
  backendRoot,
  '.venv',
  'Scripts',
  'python.exe',
);
const pythonExecutable = process.env.AGENTIC_IDE_TEST_PYTHON
  || (existsSync(virtualEnvironmentPython) ? virtualEnvironmentPython : 'python');

test('starts once on demand and serves safe file operations across workspaces', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-ide-backend-'));
  const firstWorkspace = path.join(root, 'first');
  const secondWorkspace = path.join(root, 'second');
  await mkdir(firstWorkspace);
  await mkdir(secondWorkspace);
  await writeFile(path.join(firstWorkspace, 'sample.js'), 'const marker = "alpha";\n');
  await writeFile(path.join(secondWorkspace, 'other.py'), 'marker = "beta"\n');

  const statuses = [];
  const client = new BackendClient(
    backendRoot,
    pythonExecutable,
    (status) => statuses.push(status),
    5000,
  );
  try {
    assert.equal(client.getStatus().state, 'idle');

    const [first, firstFiles, matches] = await Promise.all([
      client.request({ operation: 'validate-workspace', workspace: firstWorkspace }),
      client.request({ operation: 'list-files', workspace: firstWorkspace }),
      client.request({
        operation: 'search-text',
        workspace: firstWorkspace,
        query: 'alpha',
        case_sensitive: true,
      }),
    ]);
    assert.equal(first.path, firstWorkspace);
    assert.ok(firstFiles.some((entry) => entry.path === 'sample.js'));
    assert.deepEqual(matches, [
      { path: 'sample.js', line: 1, text: 'const marker = "alpha";' },
    ]);
    assert.equal(client.getStatus().state, 'ready');
    assert.equal(statuses.filter((status) => status.state === 'starting').length, 1);

    const contents = await client.request({
      operation: 'read-file',
      workspace: firstWorkspace,
      path: 'sample.js',
    });
    assert.equal(contents.content, 'const marker = "alpha";\n');

    const second = await client.request({
      operation: 'read-file',
      workspace: secondWorkspace,
      path: 'other.py',
    });
    assert.equal(second.content, 'marker = "beta"\n');

    const saved = await client.request({
      operation: 'write-file',
      workspace: secondWorkspace,
      path: 'other.py',
      content: 'marker = "saved"\n',
    });
    assert.equal(saved.content, 'marker = "saved"\n'    );
    const created = await client.request({
      operation: 'write-file',
      workspace: secondWorkspace,
      path: 'new-file.txt',
      content: 'created from editor\n',
      allow_create: true,
    });
    assert.equal(created.content, 'created from editor\n');
    assert.equal(
      await readFile(path.join(secondWorkspace, 'new-file.txt'), 'utf8'),
      'created from editor\n',
    );
    assert.equal(await readFile(path.join(secondWorkspace, 'other.py'), 'utf8'), 'marker = "saved"\n');

    await assert.rejects(
      client.request({
        operation: 'read-file',
        workspace: firstWorkspace,
        path: path.join(root, 'outside.txt'),
      }),
      /within the selected workspace/i,
    );
  } finally {
    const child = client.child;
    client.stop();
    if (child && child.exitCode === null) {
      await Promise.race([
        once(child, 'close'),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('reports an actionable error when Python cannot be started', async () => {
  const statuses = [];
  const missingExecutable = path.join(
    os.tmpdir(),
    `agentic-ide-missing-python-${process.pid}.exe`,
  );
  const client = new BackendClient(
    backendRoot,
    missingExecutable,
    (status) => statuses.push(status),
    1000,
  );

  await assert.rejects(
    client.request({ operation: 'health' }),
    /Could not find Python executable.*AGENTIC_IDE_PYTHON/,
  );
  assert.equal(client.getStatus().state, 'unavailable');
  assert.match(client.getStatus().message, /AGENTIC_IDE_PYTHON/);
  assert.equal(statuses.at(-1).state, 'unavailable');
  client.stop();
});
