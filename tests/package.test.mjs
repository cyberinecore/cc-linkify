import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const listed = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const shipped = listed.filter((f) => existsSync(join(root, f)));

test('the manifest carries the metadata the directory reads', () => {
  const m = readJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'cyberine-linkify');
  assert.match(m.name, /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);
  for (const key of ['description', 'version', 'license', 'homepage', 'repository', 'displayName', 'privacyPolicyUrl']) assert.ok(m[key], `plugin.json ${key}`);
  assert.equal(m.license, 'MIT');
  assert.ok(m.author?.name, 'plugin.json author.name');
  assert.equal(m.hooks, undefined, 'hooks/hooks.json loads automatically and must not be listed');
  assert.equal(m.userConfig, undefined, 'userConfig with options is a portal Block; none is declared');
  for (const key of ['documentationUrl', 'supportUrl']) assert.equal(m[key], undefined, `${key} draws an UNKNOWN_KEY warning`);
  for (const s of [m.displayName, m.author.name]) assert.match(s, /^[\x20-\x7e]+$/, 'ASCII only');
  const market = readJson('.claude-plugin/marketplace.json');
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, m.name);
  assert.equal(market.plugins[0].source, './');
  assert.ok(market.plugins[0].category, 'marketplace category');
});

test('the hooks file is the mod shape and names one module that exists', () => {
  const h = readJson('hooks/hooks.json');
  assert.ok(typeof h.description === 'string' && h.description.length > 0);
  assert.equal(h.modules.length, 1);
  assert.ok(existsSync(join(root, 'hooks', h.modules[0])));
});

test('README, LICENSE, PRIVACY and SECURITY satisfy the directory', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(/```[\s\S]*?```/g, '');
  assert.ok(readme.split(/\s+/).filter(Boolean).length >= 40, 'README has at least 40 words outside code blocks');
  assert.match(readme, /^!\[[^\]]*\]\(assets\//m, 'README shows its images with Markdown image syntax');
  assert.match(readFileSync(join(root, 'LICENSE'), 'utf8'), /MIT License/);
  for (const f of ['PRIVACY.md', 'SECURITY.md', 'CHANGELOG.md']) assert.ok(existsSync(join(root, f)), f);
});

test('shipped files follow the directory file rules', () => {
  assert.ok(shipped.length <= 512, `${shipped.length} files`);
  const seen = new Map();
  const device = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
  for (const f of shipped) {
    assert.ok(!f.startsWith('bin/'), 'no top-level bin/');
    assert.ok(!f.startsWith('.claude-plugin/types/'), `engine-generated types must not ship: ${f}`);
    assert.ok(!f.startsWith('.local/'), `.local must not ship: ${f}`);
    assert.ok(!/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(\/|$)/.test(f), `system file ${f}`);
    assert.ok(!/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|\.npmrc|bunfig\.toml|uv\.toml)$/.test(f), `lockfile or registry config ${f}`);
    for (const part of f.split('/')) {
      assert.ok(!/[:<>"|?*\\]/.test(part), `invalid character in ${f}`);
      assert.ok(!/[. ]$/.test(part), `trailing dot or space in ${f}`);
      assert.ok(!device.test(part), `device name in ${f}`);
    }
    const lower = f.toLowerCase();
    assert.ok(!seen.has(lower) || seen.get(lower) === f, `case-only duplicate ${f} vs ${seen.get(lower)}`);
    seen.set(lower, f);
    const p = join(root, f);
    assert.ok(!lstatSync(p).isSymbolicLink(), `symlink ${f}`);
    const isImage = /\.(png|jpe?g|gif|webp|svg|woff2?|ttf|otf)$/i.test(f);
    if (!isImage) assert.ok(statSync(p).size < 256 * 1024, `${f} is over 256 KiB`);
    if (!isImage) assert.ok(!readFileSync(p).includes(0), `${f} is binary`);
  }
});

test('no .gitattributes rewrites content', () => {
  for (const f of shipped.filter((t) => basename(t) === '.gitattributes')) {
    assert.ok(!/export-ignore|export-subst|filter|eol|text/.test(readFileSync(join(root, f), 'utf8')), f);
  }
});

test('no root CLAUDE.md, since strict plugin validation rejects it', () => {
  assert.ok(!shipped.includes('CLAUDE.md'));
});

test('shipped code never interpolates an upper-case identifier into a template literal', () => {
  for (const f of shipped.filter((t) => /^(hooks|src)\/.+\.(ts|tsx)$/.test(t))) {
    const text = readFileSync(join(root, f), 'utf8');
    assert.ok(!/\$\{\s*[A-Z][A-Z0-9_]*\b/.test(text), `${f} interpolates an upper-case name`);
  }
});

test('the plugin reads no transcript or memory', () => {
  for (const f of shipped.filter((t) => /^(hooks|src)\/.+\.(ts|tsx)$/.test(t))) {
    const text = readFileSync(join(root, f), 'utf8');
    assert.ok(!/\$\.session\.messages|\$\.session\.measure|transcript_path/.test(text), `${f} reads conversation data`);
  }
});
