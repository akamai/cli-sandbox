import { SandboxDatastore } from './sandbox-datastore.js';
import { SandboxRecord } from './sandbox-record.js';
import { SandboxConfig } from './sandbox-config.js';
import * as envUtils from '../utils/env-utils.js';
import * as cliUtils from '../utils/cli-utils.js';
import axios from 'axios';
import fs from "fs";
import decompress from "decompress";
import path from "path";
import shell from "shelljs";
import fsExtra from "fs-extra";
import got from "got";
import semver from 'semver';
import { glob } from 'glob';
import { pipeline } from "stream/promises";

const CLI_CACHE_PATH: string | undefined = process.env.AKAMAI_CLI_CACHE_PATH;
if (!CLI_CACHE_PATH) {
  cliUtils.logAndExit(1, 'AKAMAI_CLI_CACHE_PATH is not set.');
}

if (!fs.existsSync(CLI_CACHE_PATH)) {
  cliUtils.logAndExit(1, `AKAMAI_CLI_CACHE_PATH is set to ${CLI_CACHE_PATH} but this directory does not exist.`);
}

const GITHUB_API_URL = 'https://api.github.com/repos/akamai/sandbox-client/releases/latest';
const SANDBOX_CLI_HOME = path.join(CLI_CACHE_PATH, '/sandbox-cli/');
const DOWNLOAD_DIR = path.join(SANDBOX_CLI_HOME, '/downloads/');
const SANDBOXES_DIR = path.join(SANDBOX_CLI_HOME, '/sandboxes/');
const DATASTORE_FILE_PATH = path.join(SANDBOX_CLI_HOME + '.datastore');

let cachedGithubResponse: any | null = null;

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(SANDBOXES_DIR)) {
  fs.mkdirSync(SANDBOXES_DIR, { recursive: true });
}

const datastore = new SandboxDatastore(DATASTORE_FILE_PATH);

export async function downloadClientIfNecessary() {
  console.log('Checking for Sandbox Client...');
  if (!await isSandboxClientInstalled()) {
    console.log('No Sandbox Client found, downloading...');
    await downloadClient();
    return;
  }

  if (await isNewVersionAvailable()) {
    console.log('New version of sandbox client is available, downloading...');
    await downloadClient();
  } else {
    console.log('Sandbox Client is up to date.');
  }
}

export async function isSandboxClientInstalled(): Promise<boolean> {
  return await findLatestJar() != null;
}

async function getInstalledVersion(): Promise<string | null> {
  let latestJar = await findLatestJar();
  if (latestJar) {
    return latestJar.version;
  }
  return null;
}

async function getLatestVersion(): Promise<string> {
  const { data } = await axios.get(GITHUB_API_URL, {
    headers: { 'User-Agent': 'sandbox-cli' }
  });

  return data.tag_name; // e.g. "1.6.0"
}

async function findLatestJar(): Promise<{ path: string; version: string } | null> {
  const pattern = path.join(
    SANDBOX_CLI_HOME,
    'sandbox-client-*-RELEASE',
    'lib',
    'sandbox-client-*-RELEASE.jar'
  );

  const matches = await glob(pattern);
  if (matches.length === 0) return null;

  const withVersions = matches
    .map(filePath => {
      const match = filePath.match(/sandbox-client-(\d+\.\d+\.\d+)-RELEASE\.jar$/);
      const version = match?.[1];
      return version ? { path: filePath, version } : null;
    })
    .filter((entry): entry is { path: string; version: string } => !!entry);

  if (withVersions.length === 0) return null;

  return withVersions.reduce((max, curr) =>
    semver.gt(curr.version, max.version) ? curr : max
  );
}

async function fetchReleasesFromGitHub() {
  if (cachedGithubResponse) return cachedGithubResponse;
  const { data } = await axios.get(GITHUB_API_URL, { headers: { 'User-Agent': 'sandbox-cli' } });
  cachedGithubResponse = data;
  return cachedGithubResponse;
}

export async function downloadClient() {
  let version: string;
  let zipUrl: string;
  let fileName: string;

  try {
    const data = await fetchReleasesFromGitHub();

    version = data.tag_name; // e.g. "1.6.0"
    const asset = data.assets.find((a: any) => a.name.endsWith('-default.zip'));
    if (!asset) {
      cliUtils.logAndExit(1, `Failed to fetch sandbox-client release info from GitHub!\nNo matching ZIP asset found in latest release'`);
    }

    zipUrl = asset.browser_download_url;
    fileName = asset.name;

    console.log(`Latest version: ${version}`);
    console.log(`Downloading from: ${zipUrl}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    cliUtils.logAndExit(1, `Failed to fetch sandbox-client release info from GitHub!\n${message}`);
  }

  const destPath = path.join(DOWNLOAD_DIR, fileName);
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  try {
    await pipeline(got.stream(zipUrl), fs.createWriteStream(destPath));
    if (!fs.existsSync(destPath)) {
      cliUtils.logAndExit(1, 'Sandbox Client download failed for unknown reason!');
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    cliUtils.logAndExit(1, `Sandbox Client download failed!\n${message}`);
  }

  await unzipClient(destPath);
  console.log('Done!');
}


function unzipClient(filePath:string) {
  const CLIENT_INSTALL_PATH = filePath.replace("download/", '').replace("-default.zip", "");
  console.log(`Installing to ${CLIENT_INSTALL_PATH}`);
  return decompress(filePath, SANDBOX_CLI_HOME, {
    filter: file => !file.path.endsWith('/') // skip listing directories: https://github.com/kevva/decompress/issues/46
  });
}

export async function isNewVersionAvailable(): Promise<boolean> {
  const installed = await getInstalledVersion();
  if (!installed) return true;

  const latest = await getLatestVersion();
  return semver.gt(latest, installed);
}

function createSandboxConfig(jwt: string, name: string, origins: Array<string>, clientConfig, passThrough: boolean) {
  let config = new SandboxConfig(SANDBOXES_DIR, name);
  if (clientConfig) {
    config.useClientConfig(clientConfig);
  }
  return config.create(jwt, origins, passThrough);
}

export function registerNewSandbox(sandboxid: string, jwt: string, name: string, origins: Array<string>, clientConfig = null, passThrough: boolean) {
  const sandboxConfig = createSandboxConfig(jwt, name, origins, clientConfig, passThrough);
  const sandboxRecord = new SandboxRecord(sandboxid, name, true, name, jwt);

  datastore.save(sandboxRecord);
  console.log(`sandbox-id: ${sandboxid} ${name} is now active`);
  return sandboxConfig;
}

export function searchLocalSandboxes(str: string) {
  return getAllSandboxes().filter(sb => {
    if (sb.sandboxId.indexOf(str) >= 0 || sb.name.indexOf(str) >= 0) {
      return true;
    }
  })
}

export function makeCurrent(sandboxId: string) {
  datastore.makeCurrent(sandboxId);
}

export function getAllSandboxes(): Array<SandboxRecord> {
  return datastore.getAllRecords();
}

function getSandboxFolder(sandboxId: string) {
  const rec = datastore.getRecord(sandboxId);
  return path.join(SANDBOXES_DIR, rec.folder);
}

function getCurrentSandboxFolder() {
  return getSandboxFolder(datastore.getCurrent()!.sandboxId);
}

export function updateJWT(sandboxId: string, newJwt: string) {
  const sandboxRecord: SandboxRecord = datastore.getRecord(sandboxId);
  if (!sandboxRecord) {
    cliUtils.logAndExit(1,
      `Unable to set the new JWT into local configuration for sandbox-id: ${sandboxId}\nThe new token: ${newJwt}`
    );
    return;
  }
  sandboxRecord.jwt = newJwt;
  const sandboxConfig = new SandboxConfig(SANDBOXES_DIR, sandboxRecord.name);

  datastore.save(sandboxRecord);
  sandboxConfig.updateJwt(newJwt);
}

export function getSandboxLocalData(sandboxId: string) {
  const rec = datastore.getRecord(sandboxId);
  if (!rec) {
    return null;
  }
  return {
    isCurrent: rec.current,
    jwt: rec.jwt,
    sandboxFolder: getSandboxFolder(sandboxId),
  }
}

function getLogPath() {
  return path.join(getCurrentSandboxFolder(), '/logs')
}

export function flushLocalSandbox(sandboxId: string) {
  if (!datastore.hasRecord(sandboxId)) {
    return;
  }

  console.log('Removing local files');
  const sb = datastore.getRecord(sandboxId);
  const folderPath = path.join(SANDBOXES_DIR, sb.folder);
  fsExtra.removeSync(folderPath);
  datastore.deleteRecord(sandboxId);
}

export function getCurrentSandboxId() {
  const c = datastore.getCurrent();
  if (!c) {
    return null;
  }
  return c.sandboxId;
}

export function getCurrentSandboxName() {
  const c = datastore.getCurrent();
  if (!c) {
    return null;
  }
  return c.name;
}

export async function hasSandboxFolder(sandboxName) {
  const files = fs.readdirSync(SANDBOXES_DIR);
  return files.some(fileItem => fileItem.toLowerCase() === sandboxName.toLowerCase());
}

export async function executeSandboxClient(printLogs) {
  const loggingPath = getLogPath();
  const loggingFilePath = path.join(loggingPath, 'sandbox-client.log');
  const configPath = path.join(getCurrentSandboxFolder(), 'config.json');
  const latestJar = (await findLatestJar())!;
  const loggingConfigPath = path.join(path.dirname(path.dirname(latestJar.path)), 'conf', 'logback.xml');

  const springProfiles:string[] = [];
  if (printLogs) {
    springProfiles.push('print-logs')
  }

  const args = [
    `"${await envUtils.getJavaExecutablePath()}"`
  ];

  args.push(`-DLOG_PATH="${loggingPath}"`);
  args.push(`-DLOGGING_CONFIG_FILE="${loggingConfigPath}"`);
  args.push(`-jar "${latestJar.path}"`);
  args.push(`--config="${configPath}"`);

  if (springProfiles.length > 0) {
    args.push(`--spring.profiles.active=${springProfiles.join()}`)
  }

  const cmd = args.join(' ');

  printStartupInfo(configPath, loggingPath, loggingFilePath, loggingConfigPath, args);

  shell.exec(cmd, function (exitCode) {
    if (exitCode !== 0) {
      printStartupFailureInfo(springProfiles);
    }
  });
}

function printStartupFailureInfo(springProfiles: string[]) {
  if (springProfiles.includes('print-logs')) {
    cliUtils.logAndExit(1, 'Sandbox Client failed to start.');
  } else {
    cliUtils.logAndExit(1, 'Sandbox Client failed to start. Please check logs for more information or start client with --print-logs option.');
  }
}

function printStartupInfo(configPath: string, loggingPath: string, loggingFilePath: string, loggingConfigPath: string, args) {
  console.log('Starting Sandbox Client with arguments:');
  console.log(`Config: ${configPath}`);
  console.log(`Logging path: ${loggingPath}`);
  console.log(`Logging file: ${loggingFilePath}`);
  console.log(`Logging config: ${loggingConfigPath}\n`);
  console.log(`Arguments: ${args}\n`);
}
