import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(import.meta.dirname, '..');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const maxPackageBytes = 5_000_000;
const maxExpandedBytes = 20_000_000;
const maxPackageFiles = 100;
const allowedCategories = new Set(['AI', 'Developer Tools', 'Productivity', 'Data', 'Media', 'Communication', 'Other']);
const forbiddenExtension = /\.(?:js|mjs|cjs|jsx|ts|tsx|wasm|exe|dll|so|dylib|bat|cmd|ps1|sh)$/i;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function resolveRepoFile(relativePath) {
  assert.equal(typeof relativePath, 'string', 'A catalog path must be a string');
  assert(!relativePath.includes('\\') && !path.posix.isAbsolute(relativePath), `Unsafe path: ${relativePath}`);
  assert(relativePath.split('/').every((part) => part && part !== '.' && part !== '..'), `Unsafe path: ${relativePath}`);
  assert(relativePath.startsWith('plugins/'), `Plugin path must start in plugins/: ${relativePath}`);

  const absolute = path.resolve(root, ...relativePath.split('/'));
  assert(absolute.startsWith(`${root}${path.sep}`), `Path escaped the repository: ${relativePath}`);
  return absolute;
}

function readZipEntries(bytes) {
  assert(bytes.byteLength > 0 && bytes.byteLength <= maxPackageBytes, 'Package must be at most 5 MB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;

  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }

  assert(eocd >= 0, 'Invalid ZIP: end-of-directory record not found');
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const directoryBytes = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);

  assert(eocd + 22 + commentLength === bytes.length, 'Invalid ZIP comment length');
  assert.equal(entriesOnDisk, entryCount, 'Multi-disk ZIPs are not supported');
  assert(entryCount > 0 && entryCount <= maxPackageFiles + 10, 'ZIP has too many entries or uses ZIP64');
  assert(directoryOffset + directoryBytes === eocd, 'Unsupported ZIP layout');

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = new Map();
  let expandedTotal = 0;
  let offset = directoryOffset;

  for (let i = 0; i < entryCount; i += 1) {
    assert(offset + 46 <= eocd && view.getUint32(offset, true) === 0x02014b50, 'Corrupt ZIP directory');
    const creator = view.getUint8(offset + 5);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const fileCommentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const recordSize = 46 + nameLength + extraLength + fileCommentLength;
    const mode = creator === 3 ? externalAttributes >>> 16 : 0;

    assert(offset + recordSize <= eocd, 'Corrupt ZIP entry');
    assert((flags & 0x41) === 0, `Encrypted package entry: ${name}`);
    assert(method === 0 || method === 8, `Unsupported compression method in ${name}`);
    assert(mode === 0 || mode & 0o170000 !== 0o120000, `Symbolic links are forbidden: ${name}`);
    assert(name && !name.includes('\\') && !name.startsWith('/') && !name.includes(':'), `Unsafe package path: ${name}`);
    assert(name.split('/').every((part) => part && part !== '.' && part !== '..'), `Unsafe package path: ${name}`);
    assert(!forbiddenExtension.test(name), `Executable package content is forbidden: ${name}`);
    assert(!files.has(name), `Duplicate package entry: ${name}`);
    offset += recordSize;

    if (name.endsWith('/')) {
      continue;
    }

    assert(name === 'manifest.json' || (/^assets\/.+\.(?:png|jpe?g|webp)$/i.test(name)), `Unexpected package file: ${name}`);
    expandedTotal += expandedSize;
    assert(expandedTotal <= maxExpandedBytes, 'Package expands beyond 20 MB');
    assert(localHeaderOffset + 30 <= directoryOffset && view.getUint32(localHeaderOffset, true) === 0x04034b50, 'Invalid ZIP local header');
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);

    assert(dataOffset + compressedSize <= directoryOffset, `Truncated ZIP entry: ${name}`);
    const content = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: maxExpandedBytes });
    assert.equal(content.byteLength, expandedSize, `Incorrect expanded size: ${name}`);
    files.set(name, content);
  }

  assert.equal(offset, directoryOffset + directoryBytes, 'ZIP central directory length mismatch');
  assert(files.size > 0 && files.size <= maxPackageFiles, 'ZIP file count is outside allowed limits');
  return files;
}

function validateManifestSemantics(manifest, where) {
  assert.equal(manifest.schemaVersion, 1, `${where}: unsupported schemaVersion`);
  assert.equal(manifest.pluginApiVersion, 1, `${where}: unsupported plugin API`);
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]{0,48}\.[a-z0-9][a-z0-9-]{0,48}$/, `${where}: invalid ID`);
  assert.match(manifest.version, semanticVersion, `${where}: invalid semantic version`);
  assert(allowedCategories.has(manifest.category), `${where}: invalid category`);
  assert.equal(manifest.contribution?.type, 'host-tool', `${where}: unsupported contribution type`);
  assert.equal(manifest.contribution?.adapter, 'text-utils', `${where}: unsupported host adapter`);
  assert.deepEqual(manifest.capabilities, [], `${where}: v1 plugins cannot request capabilities`);
  assert(manifest.tools.length > 0 && manifest.tools.length <= 2, `${where}: choose at least one supported tool`);
  assert(new Set(manifest.tools).size === manifest.tools.length, `${where}: duplicate tool declaration`);
  assert(manifest.tools.every((tool) => tool === 'count' || tool === 'transform'), `${where}: unsupported tool`);
  assert(new Set((manifest.settings ?? []).map(({ key }) => key)).size === (manifest.settings ?? []).length, `${where}: duplicate setting key`);
}

const catalog = JSON.parse(await readFile(path.join(root, 'catalog/index.json'), 'utf8'));
const pluginSchema = JSON.parse(await readFile(path.join(root, 'schemas/plugin-v1.schema.json'), 'utf8'));
const catalogSchema = JSON.parse(await readFile(path.join(root, 'schemas/catalog-v1.schema.json'), 'utf8'));
ajv.addSchema(pluginSchema);
const validateCatalog = ajv.compile(catalogSchema);
const validateManifestSchema = ajv.compile(pluginSchema);

function assertSchema(valid, validator, label) {
  assert(valid, `${label} failed schema validation:\n${ajv.errorsText(validator.errors, { separator: '\n' })}`);
}

assertSchema(validateCatalog(catalog), validateCatalog, 'catalog/index.json');

const pluginIds = new Set();
for (const plugin of catalog.plugins) {
  assert(!pluginIds.has(plugin.id), `Duplicate plugin ID: ${plugin.id}`);
  pluginIds.add(plugin.id);
  assert(Array.isArray(plugin.versions) && plugin.versions.length > 0, `${plugin.id}: no versions`);
  const versions = new Set();

  for (const version of plugin.versions) {
    assert.match(version.version, semanticVersion, `${plugin.id}: invalid version`);
    assert(!versions.has(version.version), `${plugin.id}: duplicate version ${version.version}`);
    versions.add(version.version);
    const expectedVersionPath = `plugins/${plugin.id.replace('.', '/')}/${version.version}/`;
    assert(version.manifestPath.startsWith(expectedVersionPath), `${plugin.id}@${version.version}: manifest path does not match identity/version`);
    assert(version.packagePath.startsWith(expectedVersionPath), `${plugin.id}@${version.version}: package path does not match identity/version`);
    assert.notEqual(version.manifestPath, version.packagePath, `${plugin.id}@${version.version}: manifest and package paths must differ`);
    if (version.changelogPath) {
      assert(version.changelogPath.startsWith(expectedVersionPath), `${plugin.id}@${version.version}: changelog path does not match identity/version`);
    }
    const manifestBytes = await readFile(resolveRepoFile(version.manifestPath));
    const packageBytes = await readFile(resolveRepoFile(version.packagePath));
    assert.match(version.manifestSha256, /^[a-f0-9]{64}$/i, 'Invalid manifest SHA-256');
    assert.match(version.packageSha256, /^[a-f0-9]{64}$/i, 'Invalid package SHA-256');
    assert.equal(sha256(manifestBytes), version.manifestSha256.toLowerCase(), `${plugin.id}@${version.version}: manifest digest mismatch`);
    assert.equal(sha256(packageBytes), version.packageSha256.toLowerCase(), `${plugin.id}@${version.version}: package digest mismatch`);

    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    assertSchema(validateManifestSchema(manifest), validateManifestSchema, `${plugin.id}@${version.version} manifest`);
    validateManifestSemantics(manifest, `${plugin.id}@${version.version}`);
    assert.equal(manifest.id, plugin.id, 'Catalog and manifest IDs differ');
    assert.equal(manifest.version, version.version, 'Catalog and manifest versions differ');
    const packageFiles = readZipEntries(packageBytes);
    const packedManifest = packageFiles.get('manifest.json');
    assert(packedManifest, `${plugin.id}@${version.version}: ZIP is missing root manifest.json`);
    assert(isDeepStrictEqual(JSON.parse(packedManifest.toString('utf8')), manifest), `${plugin.id}@${version.version}: ZIP manifest differs from catalog manifest`);

    if (version.changelogPath) {
      const changelog = await readFile(resolveRepoFile(version.changelogPath));
      assert(changelog.byteLength > 0, `${plugin.id}@${version.version}: changelog is empty`);
    }
  }
}

console.log(`Marketplace valid: ${pluginIds.size} plugin(s).`);
