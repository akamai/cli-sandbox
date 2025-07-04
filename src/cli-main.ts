#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as envUtils from './utils/env-utils.js';
import * as cliUtils from './utils/cli-utils.js';
import * as sandboxClientManager from './service/sandbox-client-manager.js';
import * as sandboxSvc from './service/sandbox-svc.js'

import { v1 as uuidv1 } from "uuid";
import { jwtDecode } from "jwt-decode";
import validator from "validator";
import pkginfo from '../package.json' with { type: 'json' };
import Table from "easy-table";
import { Validator } from "jsonschema";
import recipeFileSchema from "../schemas/recipe.json" with {type: 'json'};
import clientConfigSchema from "../schemas/client-config.json" with {type: 'json'};
import { Command } from 'commander';

const CLI_CACHE_PATH = process.env.AKAMAI_CLI_CACHE_PATH;

if (!CLI_CACHE_PATH) {
  cliUtils.logAndExit(1, 'AKAMAI_CLI_CACHE_PATH is not set.');
}

if (!fs.existsSync(CLI_CACHE_PATH)) {
  cliUtils.logAndExit(1, `AKAMAI_CLI_CACHE_PATH is set to ${CLI_CACHE_PATH} but this directory does not exist.`);
}

if (envUtils.getNodeVersion() < 20) {
  cliUtils.logAndExit(1, 'The Akamai Sandbox CLI requires Node 20 or later.');
}
const jsonSchemaValidator = new Validator();
jsonSchemaValidator.addSchema(clientConfigSchema, '#clientConfig');

const OriginMapping = {
  FROM_CONFIG: 'config',
  FROM_PROPERTY: 'property'
}

function validateSchema(json) {
  return jsonSchemaValidator.validate(json, recipeFileSchema);
}

function readFileAsString(path) {
  const data = fs.readFileSync(path);
  return data.toString();
}

function showLocalSandboxes() {
  console.log('Local sandboxes:\n');
  const sandboxes = sandboxClientManager.getAllSandboxes().map(sb => {
    return {
      current: sb.current ? 'YES' : '',
      name: sb.name,
      sandbox_id: sb.sandboxId,
      jwt_expiration: jwtExpirationDateString(sb.jwt)
    }
  });
  showSandboxesTable(sandboxes);
}

function showSandboxesTable(sandboxes) {
  if (sandboxes.length === 0) {
    console.log('No sandboxes found.');
  } else {
    Table.log(sandboxes, {
      current: {name: 'Default'},
      name: {name: 'Sandbox Name'},
      sandbox_id: {name: 'Sandbox ID'},
      jwt_expiration: {name: 'JWT Expiration Date'}
    });
  }
}

async function showRemoteSandboxes() {
  console.log('Loading sandboxes: \n');
  const localIds = new Set();
  sandboxClientManager.getAllSandboxes().forEach(sb => localIds.add(sb.sandboxId));
  const allSandboxesResult = await cliUtils.spinner(sandboxSvc.getAllSandboxes());
  const quota = allSandboxesResult.quota;
  const sandboxes = allSandboxesResult.result.sandboxes.map(sb => {
    return {
      has_local: localIds.has(sb.sandboxId) ? 'Y' : 'N',
      name: sb.name,
      sandbox_id: sb.sandboxId,
      status: sb.status
    }
  });
  showSandboxesTable(sandboxes);
  console.log(`${quota.used}/${quota.max} sandboxes used.`)
}

async function getRulesForSandboxId(sandboxId: string) {
  const sandbox: any = await cliUtils.spinner(sandboxSvc.getSandbox(sandboxId));
  const pIds = sandbox.properties.map(p => p.sandboxPropertyId);
  const r = [];

  for (let pid of pIds) {
    const obj: any = await cliUtils.spinner(sandboxSvc.getRules(sandboxId, pid));
    r.push({
      title: `sandbox-property-id: ${pid}`,
      rules: obj.rules
    });
  }
  return r;
}

function populateOrigins(papiNode, originsList) {
  if (papiNode == null) {
    return;
  }
  if (papiNode.behaviors) {
    papiNode.behaviors
      .filter(b => b.name === 'origin')
      .filter(b => b.options && b.options.hostname)
      .forEach(b => {
        originsList.push(b.options.hostname);
      });
  }

  if (papiNode.children) {
    papiNode.children.forEach(c => {
      populateOrigins(c, originsList);
    });
  }
}

function getOriginsForPapiRules(papiRules) {
  const o = [];
  populateOrigins(papiRules, o);
  return o;
}

function jwtExpirationDateString(jwtToken) {
  try {
    const decoded = jwtDecode(jwtToken);
    const expirationDate = decoded['exp'] * 1000;
    return cliUtils.dateToString(expirationDate);
  } catch (e) {
    return 'unknown';
  }
}

async function showSandboxOverview(sandboxId: string) {
  const localSandbox = sandboxClientManager.getSandboxLocalData(sandboxId);
  if (localSandbox) {
    cliUtils.logWithBorder('Local sandbox information');
    console.log('sandbox-id: ' + sandboxId);
    console.log('local directory: ' + localSandbox.sandboxFolder);
    console.log(`JWT expiration: ${jwtExpirationDateString(localSandbox.jwt)}`);
    console.log(`default: ${localSandbox.isCurrent}\n`);
  }
  const sandbox = await cliUtils.spinner(sandboxSvc.getSandbox(sandboxId));
  const properties = await cliUtils.spinner(Promise.all(
    sandbox.properties.map(p => sandboxSvc.getProperty(sandboxId, p.sandboxPropertyId)))
  );

  cliUtils.logWithBorder('Detailed information for the sandbox');

  console.log(`name: ${sandbox.name}`);
  console.log(`created by: ${sandbox.createdBy}`);
  console.log(`cloneable: ${sandbox.isClonable}`);
  console.log(`status: ${sandbox.status}\n`);

  cliUtils.logWithBorder('Sandbox Properties');

  properties.forEach(p => {
    console.log('sandbox-property-id: ' + p.sandboxPropertyId);
    console.log('cpcode: ' + p.cpcode);
    console.log(`request hostname(s): ${p.requestHostnames.join(', ')}\n`);
  });
}

function getLocalSandboxForIdentifier(identifier: string, failOnNoResult = true) {
  const results = sandboxClientManager.searchLocalSandboxes(identifier);
  if (results.length == 0) {
    if (failOnNoResult) {
      cliUtils.logAndExit(1, `Could not find any local sandboxes matching input: ${identifier}`)
    } else {
      return null;
    }
  } else if (results.length > 1) {
    cliUtils.logAndExit(1,
      `${results.length} sandbox identifiers share: '${identifier}'. To identify a sandbox, provide a longer matching phrase.`);
  } else {
    return results[0];
  }
}

function orCurrent(sandboxIdentifier) {
  if (sandboxIdentifier) {
    return sandboxIdentifier;
  }
  if (!sandboxClientManager.hasCurrent()) {
    return 'Undefined sandbox-id. Provide a sandbox-id or set a default value.';
  }
  return sandboxClientManager.getCurrentSandboxId();
}

function getSandboxIdFromIdentifier(sandboxIdentifier: string) {
  const sb = getLocalSandboxForIdentifier(sandboxIdentifier, false);
  if (sb) {
    return sb.sandboxId;
  } else {
    return sandboxIdentifier;
  }
}

function parseToBoolean(str: string) {
  if (!str) {
    return false;
  }
  const parsedInput = str.trim().toLowerCase();
  const strToBool = new Map([
    ['true', true],
    ['t', true],
    ['y', true],
    ['yes', true],
    ['false', false],
    ['f', false],
    ['n', false],
    ['no', false],
  ]);
  if (!strToBool.has(parsedInput)) {
    cliUtils.logAndExit(1, `Unable to determine boolean value from input: ${str}. Enter y/n.`)
  } else {
    return strToBool.get(parsedInput);
  }
}

async function updateProperty(sandboxId, sandboxPropertyId, requestHostnames, cpCode, rulesFilePath) {
  if (requestHostnames || cpCode) {
    const property = await cliUtils.spinner(sandboxSvc.getProperty(sandboxId, sandboxPropertyId), `Loading a property with id: ${sandboxPropertyId}`);

    if (requestHostnames) {
      property.requestHostnames = parseHostnameCsv(requestHostnames);
    }
    if (cpCode) {
      property.cpcode = cpCode;
    }

    await cliUtils.spinner(sandboxSvc.updateProperty(sandboxId, property), `Updating sandbox-property-id: ${sandboxPropertyId}`);
  }

  if (rulesFilePath) {
    const rules = getJsonFromFile(rulesFilePath);
    await cliUtils.spinner(sandboxSvc.updateRules(sandboxId, sandboxPropertyId, rules), 'Updating rules.');
  }
}

function getJsonFromFile(papiFilePath) {
  try {
    return JSON.parse(readFileAsString(papiFilePath));
  } catch (ex) {
    cliUtils.logError('JSON file is invalid.' + ex);
    throw ex;
  }
}

function parseHostnameCsv(csv) {
  return csv.split(',')
    .map(hn => hn.trim().toLowerCase())
    .filter(hn => hn.length > 0);
}

async function addPropertyFromRules(sandboxId: string, papiFilePath: string, hostnames: Array<string>, cpCode: number) {
  if (!fs.existsSync(papiFilePath)) {
    cliUtils.logAndExit(1, `File: ${papiFilePath} does not exist.`);
  }
  const papiJson = getJsonFromFile(papiFilePath);
  return await cliUtils.spinner(sandboxSvc.addPropertyFromRules(sandboxId, hostnames, cpCode, papiJson), `adding sandbox property to ${sandboxId}`);
}

async function createFromRules(papiFilePath: string, propForRules: string, hostnames: Array<string>, isClonable: boolean, name: string, cpcode: number) {
  if (!fs.existsSync(papiFilePath)) {
    cliUtils.logAndExit(1, `File: ${papiFilePath} does not exist.`);
  }
  const papiJson = getJsonFromFile(papiFilePath);
  return await cliUtils.spinner(sandboxSvc.createFromRules(papiJson, propForRules, hostnames, name, isClonable, cpcode), 'creating new sandbox');
}

function parsePropertySpecifier(propertySpecifier) {
  let propertySpec;
  let propertyVersion;
  if (propertySpecifier.indexOf(':') > -1) {
    const parts = propertySpecifier.split(':').map(s => s.trim().toLowerCase());
    propertySpec = parts[0];
    propertyVersion = parts[1];
  } else {
    propertySpec = propertySpecifier.trim().toLowerCase();
  }

  if (propertyVersion && !validator.isInt(propertyVersion, {min: 1})) {
    cliUtils.logAndExit(1, `Property version: ${propertyVersion} must be an integer > 0.`);
  }

  const propertySpecObj: any = {};
  let key;
  if (validator.isInt(propertySpec)) {
    key = 'propertyId';
  } else {
    key = 'propertyName';
  }

  propertySpecObj[key] = propertySpec;
  if (propertyVersion) {
    propertySpecObj.propertyVersion = propertyVersion;
  }
  return propertySpecObj;
}

function parseHostnameSpecifier(hostnameSpecifier) {
  return {hostname: hostnameSpecifier};
}

async function addPropertyToSandboxFromProperty(sandboxId: string, hostnames: Array<string>, cpCode: number, propertySpecifier: string) {
  const propertySpecObj = parsePropertySpecifier(propertySpecifier);
  const msg = `Adding property from: ${JSON.stringify(propertySpecObj)}`;
  return await cliUtils.spinner(sandboxSvc.addPropertyFromProperty(sandboxId, hostnames, cpCode, propertySpecObj), msg);
}

async function addPropertyToSandboxFromHostname(sandboxId: string, hostnames: Array<string>, cpCode: number, hostname: string) {
  const msg = `Adding property based on: ${hostname}`;
  return await cliUtils.spinner(sandboxSvc.addPropertyFromProperty(sandboxId, hostnames, cpCode, {hostname}), msg);
}

async function createFromProperty(propertySpecifier: string, hostnames: Array<string>, isClonable: boolean, name: string, cpcode: number) {
  const propertySpecObj = parsePropertySpecifier(propertySpecifier);
  const msg = `Creating from: ${JSON.stringify(propertySpecObj)}`;
  return await cliUtils.spinner(sandboxSvc.createFromProperty(hostnames, name, isClonable, propertySpecObj, cpcode), msg);
}

async function createFromHostname(hostname: string, hostnames: Array<string>, isClonable: boolean, name: string, cpcode: number) {
  const msg = `Creating from: ${hostname}`;
  return await cliUtils.spinner(sandboxSvc.createFromProperty(hostnames, name, isClonable, {hostname}, cpcode), msg);
}

async function getOriginListForSandboxId(sandboxId: string): Promise<Array<string>> {
  const rulesList = await getRulesForSandboxId(sandboxId);
  const origins = new Set<string>();
  rulesList.forEach(entry => {
    const originsForRules = getOriginsForPapiRules(entry.rules);
    originsForRules.forEach(o => origins.add(o));
  });
  return Array.from(origins);
}

function resolveRulesPath(recipeFilePath, rulesPath) {
  // if path is absolute then it exists
  if (fs.existsSync(rulesPath)) {
    return rulesPath;
  }
  return path.join(path.dirname(recipeFilePath), rulesPath);
}

async function createFromPropertiesRecipe(recipe, cpcode) {
  const cloneable = recipe.sandbox.clonable
  const sandboxName = recipe.sandbox.name
  const properties = recipe.sandbox.properties;

  const firstProp = properties[0];
  let propForRules;
  if (firstProp.rulesPath) {
    console.log(`Found rules in properties. Locating property to include in the sandbox.`);

    if (firstProp.property) {
      propForRules = parsePropertySpecifier(firstProp.property);
    } else if (firstProp.hostname) {
      propForRules = firstProp.hostname;
    }
  }

  console.log(`Creating sandbox and property 1 from recipe.`);
  const r = await cliUtils.spinner(createRecipeSandboxAndProperty(firstProp, propForRules, cloneable, sandboxName,
    cpcode || firstProp.cpcode));

  for (let i = 1; i < properties.length; i++) {
    try {
      console.log(`Creating property ${i + 1} from recipe.`);
      await cliUtils.spinner(createRecipeProperty(properties[i], r.sandboxId));
    } catch (e) {
      cliUtils.logError(e);
    }
  }
  return r;
}

function createFromCloneRecipe(recipe) {
  const cloneFrom = recipe.sandbox.cloneFrom;
  if (!cloneFrom) {
    cliUtils.logAndExit(1, 'Missing sandbox.cloneFrom.');
  }
  const sandboxId = cloneFrom.sandboxId;
  if (!sandboxId) {
    cliUtils.logAndExit(1, 'Missing cloneFrom.sandboxId.');
  }
  const clonable = cloneFrom.clonable;
  return sandboxSvc.cloneSandbox(sandboxId, recipe.sandbox.name, clonable);
}

function validateAndBuildRecipe(recipeFilePath, name, clonable): any {
  if (typeof name !== 'string') {
    name = null;
  }

  console.log('Validating recipe file.');

  if (!fs.existsSync(recipeFilePath)) {
    cliUtils.logAndExit(1, `File ${recipeFilePath} does not exist.`);
  }
  const recipe = getJsonFromFile(recipeFilePath);
  const r = validateSchema(recipe);
  if (r.errors.length > 0) {
    cliUtils.logAndExit(1, `There are issues with your recipe file\n ${r}`);
  }
  const sandboxRecipe = recipe.sandbox;
  sandboxRecipe.clonable = clonable || sandboxRecipe.clonable;
  sandboxRecipe.name = name || sandboxRecipe.name;
  let idx = 0;

  if (sandboxRecipe.properties) {
    sandboxRecipe.properties.forEach(p => {
      if (p.rulesPath) {
        if (!oneOf(p.property, p.hostname)) {
          cliUtils.logAndExit(1, `Error with property ${idx} In order to use the rulesPath, you need to specify a property or hostname to base the sandbox on.`);
        }
        p.rulesPath = resolveRulesPath(recipeFilePath, p.rulesPath);
      }
      idx++;
    });

    idx = 0;
    sandboxRecipe.properties.forEach(p => {
      if (!oneOf(p.property, p.hostname)) {
        cliUtils.logAndExit(1, `Error with property ${idx} Specify only one argument, choose either property or hostname.`);
      }
      if (p.rulesPath && !fs.existsSync(p.rulesPath)) {
        cliUtils.logAndExit(1, `Error with property ${idx} could not load file at path: ${p.rulesPath}`);
      }

      idx++;
    });
  }
  return recipe;
}

async function updateFromRecipe(sandboxId, recipeFilePath, name, clonable) {
  const recipe = validateAndBuildRecipe(recipeFilePath, name, clonable);
  const sandboxRecipe = recipe.sandbox;

  if (recipe.sandbox.cloneFrom) {
    cliUtils.logAndExit(1, 'You cannot use the update command with cloneFrom recipe.');
  }

  if (!sandboxRecipe.properties) {
    cliUtils.logAndExit(1, 'Missing properties, unable to perform operation.');
  }
  console.log(`Loading information for sandbox-id: ${sandboxId}`);
  const sandbox: any = await cliUtils.spinner(sandboxSvc.getSandbox(sandboxId));
  sandbox.isClonable = recipe.clonable;
  sandbox.name = recipe.name;

  console.log(`Updating sandbox information for sandbox-id: ${sandboxId}`);
  await sandboxSvc.updateSandbox(sandbox);

  const pIds = sandbox.properties.map(p => p.sandboxPropertyId);
  const first = pIds[0];
  for (let i = 1; i < pIds.length; i++) {
    const propertyId = pIds[i];
    console.log(`Deleting sandbox-property-id: ${propertyId}`);
    await cliUtils.spinner(sandboxSvc.deleteProperty(sandboxId, propertyId));
  }

  const propertyObj = {
    sandboxPropertyId: first,
    requestHostnames: [uuidv1()]
  };

  console.log(`Updating sandbox-property-id: ${first}`);
  await cliUtils.spinner(sandboxSvc.updateProperty(sandboxId, propertyObj));

  for (let i = 0; i < sandboxRecipe.properties.length; i++) {
    const rp = sandboxRecipe.properties[i];
    console.log(`Re-building property: ${i + 1}`);
    await cliUtils.spinner(createRecipeProperty(rp, sandboxId));
  }

  console.log(`Deleting sandbox-property-id: ${first}`);
  await cliUtils.spinner(sandboxSvc.deleteProperty(sandboxId, first));
}

async function createFromRecipe(recipeFilePath, name, clonable, cpcode, originFrom) {
  const recipe = validateAndBuildRecipe(recipeFilePath, name, clonable);

  const sandboxRecipe = recipe.sandbox;

  let res = null;
  if (sandboxRecipe.properties) {
    res = await createFromPropertiesRecipe(recipe, cpcode);
  } else if (sandboxRecipe.cloneFrom) {
    res = await createFromCloneRecipe(recipe);
  } else {
    cliUtils.logAndExit(1, 'could not find either sandbox.properties or sandbox.cloneFrom.');
    return
  }

  const sandboxName = typeof sandboxRecipe.name === 'string' ? sandboxRecipe.name : res.sandboxId;

  await registerSandbox(
    res.sandboxId,
    res.jwtToken,
    sandboxName,
    originFrom,
    recipe.clientConfig
  );
}

function createRecipeProperty(rp, sandboxId) {
  if (rp.property) {
    return addPropertyToSandboxFromProperty(sandboxId, rp.requestHostnames, rp.cpcode, rp.property);
  } else if (rp.rulesPath) {
    return addPropertyFromRules(sandboxId, rp.rulesPath, rp.requestHostnames, rp.cpcode);
  } else if (rp.hostname) {
    return addPropertyToSandboxFromHostname(sandboxId, rp.requestHostnames, rp.cpcode, rp.hostname);
  } else {
    cliUtils.logAndExit(1, 'Critical error with recipe property. Define the rulesPath or property.');
  }
}

function createRecipeSandboxAndProperty(rp, propertyForRules, isCloneable, sandboxName, cpcode) {
  if (rp.property) {
    return createFromProperty(rp.property, rp.requestHostnames, isCloneable, sandboxName, cpcode);
  } else if (rp.hostname) {
    return createFromHostname(rp.hostname, rp.requestHostnames, isCloneable, sandboxName, cpcode);
  } else if (rp.rulesPath) {
    return createFromRules(rp.rulesPath, propertyForRules, rp.requestHostnames, isCloneable, sandboxName, cpcode);
  } else {
    cliUtils.logAndExit(1, 'Critical error with recipe property. Define the rulesPath or property.');
  }
}

function oneOf(...args: any[]) {
  let r = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i]) {
      if (r) {
        return false;
      }
      r = true;
    }
  }
  return r;
}

function isNonEmptyString(obj) {
  return obj !== null
    && obj !== undefined
    && (typeof obj === 'string')
    && obj.trim().length > 0;
}

async function registerSandbox(sandboxId: string, jwt: string, name: string, originFrom: string, clientConfig = null) {
  console.log('building origin list');
  const origins: Array<string> = await getOriginListForSandboxId(sandboxId);
  let passThrough = false;
  let hasVariableForOrigin = false;

  if (origins.length > 0) {
    console.log(`Detected the following origins: ${origins.join(', ')}`);
    const regexPMUserVariable = new RegExp('(\{\{(.)+\}\})');
    hasVariableForOrigin = origins.some(origin => regexPMUserVariable.test(origin));
    passThrough = await shouldPassThrough(originFrom);
  }

  console.log('registering sandbox in local datastore');
  const registration = sandboxClientManager.registerNewSandbox(sandboxId, jwt, name, origins, clientConfig, passThrough);

  console.info(`Successfully created sandbox-id ${sandboxId} Generated sandbox client configuration at ${registration.configPath} Edit this file to specify the port and host for your dev environment.`);
  if (hasVariableForOrigin) {
    cliUtils.logError(`At least one property of this sandbox has a user defined variable for origin hostname.
    Edit the sandbox client configuration file ${registration.configPath} and replace the variable with a static hostname.`);
  }
}

async function shouldPassThrough(originFrom: string) {
  if (originFrom) {
    if (originFrom === OriginMapping.FROM_CONFIG) {
      return false;
    } else if (originFrom === OriginMapping.FROM_PROPERTY) {
      return true;
    }
  } else {
    if (await cliUtils.confirm('Do you want the Sandbox Client to proxy the origins in your dev environment to the destination defined in the Akamai config? Enter **y** and the CLI will automatically update your configuration file. If you want to route sandbox traffic to different development origins, enter **n** to customize the origin mappings.')) {
      return true;
    }
  }
  return false;
}

async function downloadClientIfNecessary() {
  try {
    if (!sandboxClientManager.isAlreadyInstalled()) {
      console.log('No Sandbox Client installed. Installing sandbox client...');
      await sandboxClientManager.downloadClient();
    }
  } catch (e) {
    cliUtils.logAndExit(1, 'occurred during client download: ' + e);
  }
}

function addPropertyToSandbox(sandboxId, property, rulesPath, hostname, requestHostnames, cpCode) {
  if (property) {
    return addPropertyToSandboxFromProperty(sandboxId, requestHostnames, cpCode, property);
  } else if (rulesPath) {
    return addPropertyFromRules(sandboxId, rulesPath, requestHostnames, cpCode);
  } else if (hostname) {
    return addPropertyToSandboxFromHostname(sandboxId, requestHostnames, cpCode, hostname);
  } else {
    cliUtils.logAndExit(1, `Critical error while adding property to the sandbox : ${sandboxId} You need to define the rulesPath or property.`);
  }
}

async function pushEdgeWorkerToSandbox(sandboxId, edgeworkerId, edgeworkerTarballPath, action) {
  action = (action == 'add') ? 'adding' : 'updating';
  const msg = `${action} edgeworker ${edgeworkerId} for: ${sandboxId} from ${edgeworkerTarballPath}`;
  return await cliUtils.spinner(sandboxSvc.pushEdgeWorkerToSandbox(sandboxId, edgeworkerId, edgeworkerTarballPath), msg);
}

async function addOrUpdateEdgeWorker(edgeworkerId, edgeworkerTarballPath, action) {
  try {
    let sandboxId = sandboxClientManager.getCurrentSandboxId();
    if (!sandboxId) {
      cliUtils.logAndExit(1, 'Unable to determine sandbox-id');
    }

    if (!fs.existsSync(edgeworkerTarballPath)) {
      cliUtils.logAndExit(1, `Provided edgeworker tarball path ${edgeworkerTarballPath} not found.`);
    }
    let buffer = fs.readFileSync(edgeworkerTarballPath);
    buffer.toString('hex');
    await pushEdgeWorkerToSandbox(sandboxId, edgeworkerId, edgeworkerTarballPath, action);
    console.log('done!');
  } catch (e) {
    handleException(e);
  }
}

async function pullEdgeWorkerFromSandbox(sandboxId, edgeworkerId) {
  const msg = `Downloading edgeworker ${edgeworkerId} for sandbox-id: ${sandboxId}`;
  return await cliUtils.spinner(sandboxSvc.pullEdgeWorkerFromSandbox(sandboxId, edgeworkerId), msg);
}

async function makeFileForEdgeworker(edgeworkerId, hexFile) {
  let edgeworkerFolder = path.join(process.env.AKAMAI_CLI_CACHE_PATH,
    `sandbox-cli/sandboxes`,
    sandboxClientManager.getCurrentSandboxName(),
    'edgeworkers/');
  if (!fs.existsSync(edgeworkerFolder)) {
    fs.mkdirSync(edgeworkerFolder);
  }
  let filename = `${edgeworkerId}_${new Date().getTime()}.tgz`;
  fs.writeFileSync(`${edgeworkerFolder}/${filename}`, Buffer.from(hexFile, 'hex'));
  console.log(`Downloaded edgeworker file :${filename} for edgeworker id : ${edgeworkerId} at location : ${edgeworkerFolder}`);
}

async function deleteEdgeWorkerFromSandbox(sandboxId, edgeworkerId) {
  const msg = `deleting edgeworker ${edgeworkerId} for: ${sandboxId}`;
  return await cliUtils.spinner(sandboxSvc.deleteEdgeWorkerFromSandbox(sandboxId, edgeworkerId), msg);
}

function validateArgument(optionName, optionValue, allowedValues: String[]) {
  if (optionValue) {
    if (allowedValues.indexOf(optionValue) < 0) {
      cliUtils.logAndExit(1,
        `Invalid option argument for ${optionName}: '${optionValue}'. Valid values are: ${allowedValues.join(', ')}`);
    }
  }
}

function handleException(error) {
  if (error instanceof Error) {
    cliUtils.logAndExit(1, 'unexpected error occurred: ' + error);
  } else {
    cliUtils.logAndExit(1, 'got unexpected response from API:\n' + error);
  }
}

function helpExitOnNoArgs(cmd) {
  const len = process.argv.slice(2).length;
  if (!len || len <= 1) {
    cmd.outputHelp();
    process.exit();
  }
}

const program = new Command()
  .version(pkginfo.version, '-V, --version', 'Output the current version.')
  .helpOption('-h, --help', 'Output usage information.')

program
  .description(pkginfo.description)
  .option('--debug', 'Show debug information.')
  .option('--edgerc <file>', 'Use edgerc file for authentication.')
  .option('--section <name>', 'Use this section in edgerc file that contains the credential set.')
  .option('--accountkey <account-id>', 'Use given internal parameter.')
  .on('option:edgerc', function(edgeRcFilePath) {
    envUtils.setEdgeRcFilePath(edgeRcFilePath);
  })
  .on('option:section', function(section) {
    envUtils.setEdgeRcSection(section);
  })
  .on('option:accountkey', function(key) {
    sandboxSvc.setAccountKey(key);
  })
  .on('option:debug', function() {
    envUtils.setDebugMode(true);
  })
  .on('command:*', function(operands) {
    cliUtils.logAndExit(1, `Unknown command '${operands[0]}'. See 'akamai sandbox --help'.`);
  });

program
  .command('help [command]')
  .description('Displays help information for the given command.')
  .action(function(arg) {
    if (!arg) {
      program.outputHelp();
    } else {
      const command = program.commands.find(c => c._name == arg);
      if (!command) {
        console.log(`Could not find a command for ${arg}`);
      } else {
        command.outputHelp();
      }
    }
  });

program
  .command('install')
  .description('Downloads and installs the Sandbox Client software.')
  .action(async function() {
    try {
      if (sandboxClientManager.isAlreadyInstalled()) {
        console.log('Sandbox Client is already installed.');
      } else {
        await downloadClientIfNecessary();
      }
    } catch (e) {
      handleException(e);
    }
  });

program
  .command('list')
  .alias('ls')
  .description('Lists sandboxes that are available locally.')
  .option('-r, --remote', 'Show sandboxes from the server.')
  .action(async function(options) {
    try {
      if (options.remote) {
        await showRemoteSandboxes();
      } else {
        showLocalSandboxes();
      }
    } catch (e) {
      handleException(e);
    }
  });

program
  .command('show [sandbox-id]')
  .description('Shows details about the sandbox and JWT expiration date.')
  .action(async function(arg) {
    try {
      let sandboxIdToUse = null;
      if (!arg) {
        if (sandboxClientManager.hasCurrent()) {
          sandboxIdToUse = sandboxClientManager.getCurrentSandboxId();
        } else {
          cliUtils.logAndExit(1, 'Unable to determine sandbox-id.');
        }
      } else {
        sandboxIdToUse = getSandboxIdFromIdentifier(arg);
      }
      await showSandboxOverview(sandboxIdToUse);
    } catch (e) {
      handleException(e);
    }
  });

program
  .command('rules [sandbox-id]')
  .description('Shows a rules tree for the sandbox.')
  .action(async function(arg) {
    try {
      let sandboxIdToUse = null;
      if (!arg) {
        if (sandboxClientManager.hasCurrent()) {
          sandboxIdToUse = sandboxClientManager.getCurrentSandboxId();
        } else {
          cliUtils.logAndExit(1, 'Unable to determine sandbox-id.');
        }
      } else {
        sandboxIdToUse = getSandboxIdFromIdentifier(arg);
      }
      const rulesList = await getRulesForSandboxId(sandboxIdToUse);
      rulesList.forEach(o => {
        cliUtils.logWithBorder(o.title, 'err');
        console.log(cliUtils.toJsonPretty(o.rules));
      })
    } catch (e) {
      handleException(e);
    }
  });

program
  .command('use <sandbox-id>')
  .description('Sets a default sandbox for commands requiring [sandbox-id].')
  .action(function(sandboxId) {
    const sb = getLocalSandboxForIdentifier(sandboxId);
    sandboxClientManager.makeCurrent(sb.sandboxId);
    console.log(`Sandbox: ${sb.name} is now active`)
  });

program
  .command('delete <sandbox-id>')
  .description('Deletes the sandbox.')
  .option('-f, --force', 'Attempt to remove the sandbox without prompting for confirmation.')
  .action(async function(sandboxId, options) {
    const forceDelete = !!options.force;
    try {
      if (!forceDelete) {
        if (!await cliUtils.confirm('Are you sure you want to delete this sandbox?')) {
          return;
        }
      }

      const progressMsg = `Deleting sandbox-id: ${sandboxId}`;
      await cliUtils.spinner(sandboxSvc.deleteSandbox(sandboxId), progressMsg);

      sandboxClientManager.flushLocalSandbox(sandboxId);
    } catch (e) {
      handleException(e);
    }
  });

program
  .command('update-property <sandbox-id> <sandbox-property-id>')
  .description('Updates the sandbox’s property.')
  .option('-r, --rules <file>', 'JSON file containing a PAPI rule tree.')
  .option('-H, --requesthostnames <string>', 'Comma-delimited list of request hostnames within the sandbox.')
  .option('-C, --cpcode <cpcode>', 'Specify an existing cpcode instead of letting the system generate a new one.')
  .action(async function(sandboxId, sandboxPropertyId, options) {
    const rules = options.rules;
    const requestHostnames = options.requesthostnames;
    const cpCode = options.cpcode;
    try {
      await updateProperty(sandboxId, sandboxPropertyId, requestHostnames, cpCode, rules);
      console.log(`Successfully updated sandbox-id: ${sandboxId} sandbox-property-id: ${sandboxPropertyId}`);
    } catch (e) {
      handleException(e);
    }
  });

program
  .command('update [sandbox-id]')
  .description('Updates the sandbox.')
  .option('-r, --rules <file>', 'JSON file containing a PAPI rule tree.')
  .option('-c, --clonable <boolean>', 'Make this sandbox clonable? (Y/N)')
  .option('-n, --name <string>', 'Name of sandbox.')
  .option('-C, --cpcode <cpcode>', 'Specify an existing cpcode instead of letting the system generate a new one.')
  .option('-H, --requesthostnames <string>', 'Comma-delimited list of request hostnames within the sandbox.')
  .option('--recipe <file>', 'Path to `recipe.json` file.')
  .action(async function(arg, options) {
    helpExitOnNoArgs(options);
    try {
      const clonable = parseToBoolean(options.clonable);
      const sandboxId = getSandboxIdFromIdentifier(orCurrent(arg));
      const recipeFilePath = options.recipe;
      if (recipeFilePath) {
        await updateFromRecipe(sandboxId, recipeFilePath, options.name, clonable);
        return;
      }
      const sandbox = await cliUtils.spinner(sandboxSvc.getSandbox(sandboxId), `Loading a sandbox with id: ${sandboxId}`);
      if (options.clonable) {
        sandbox.isClonable = clonable;
      }
      if (isNonEmptyString(options.name)) {
        sandbox.name = options.name;
      }

      await cliUtils.spinner(sandboxSvc.updateSandbox(sandbox), `updating sandbox-id: ${sandbox.sandboxId}`);

      const propertyChange: boolean = !!options.cpcode || !!options.requesthostnames || !!options.rules;
      if (propertyChange && sandbox.properties.length > 1) {
        cliUtils.logAndExit(1, `Unable to update property as multiple were found (${sandbox.properties.length}). Use update-property to add additional properties to the sandbox.`);
      }
      const sandboxPropertyId = sandbox.properties[0].sandboxPropertyId;
      await updateProperty(sandboxId, sandboxPropertyId, options.requesthostnames, options.cpcode, options.rules);
      console.log(`Successfully updated sandbox-id: ${sandboxId}`)
    } catch (e) {
      handleException(e);
    }
  });

program
  .command('clone <sandbox-id>')
  .description('Clones the sandbox.')
  .option('-n, --name <string>', 'Name of the sandbox.')
  .option('--origin-from <property | config>', 'Redirect origin traffic to the origins defined in your Akamai property or config file.')
  .action(async function(arg, options) {
    validateArgument('--origin-from', options.originFrom, [OriginMapping.FROM_CONFIG, OriginMapping.FROM_PROPERTY]);
    try {
      const sandboxId = getSandboxIdFromIdentifier(arg);
      if (!isNonEmptyString(options.name)) {
        cliUtils.logAndExit(1, 'Parameter --name is required.');
      }
      const name = options.name;
      const cloneResponse = await cliUtils.spinner(sandboxSvc.cloneSandbox(sandboxId, name));

      await registerSandbox(cloneResponse.sandboxId, cloneResponse.jwtToken, name, options.originFrom);
    } catch (e) {
      handleException(e);
    }
  });

program
  .command('create')
  .description('Creates a new sandbox.')
  .option('-r, --rules <file>', 'JSON file containing a PAPI rule tree. You need to specify a property or hostname to base the sandbox on when using this method.')
  .option('-p, --property <property-id | property-name:version>', 'Property to base the sandbox on. If an active version is not found, the most recent version is used.')
  .option('-o, --hostname <hostname>', 'The hostname of your Akamai property, such as www.example.com.')
  .option('-c, --clonable <boolean>', 'Make this sandbox clonable.')
  .option('-n, --name <string>', 'Name of the sandbox.')
  .option('-H, --requesthostnames <string>', 'Comma separated list of request hostnames.')
  .option('--recipe <file>', 'Path to recipe.json file.')
  .option('-C, --cpcode <cpcode>', 'Specify an existing cpcode instead of letting the system generate a new one.')
  .option('--origin-from <property | config>', 'Redirect origin traffic to the origins defined in your Akamai property or config file.')
  .action(async function(options) {
    helpExitOnNoArgs(options);
    validateArgument('--origin-from', options.originFrom, [OriginMapping.FROM_CONFIG, OriginMapping.FROM_PROPERTY]);

    const cpCode = options.cpcode;
    try {
      const recipePath = options.recipe;
      if (recipePath) {
        await createFromRecipe(recipePath, options.name, options.clonable, cpCode, options.originFrom);
        return;
      }

      const papiFilePath = options.rules;
      const name = options.name;
      const hostnamesCsv = options.requesthostnames;
      const isClonable = parseToBoolean(options.clonable);

      const propertySpecifier = options.property;
      const hostnameSpecifier = options.hostname;

      let propForRules;
      //validation
      if (!isNonEmptyString(name)) {
        cliUtils.logAndExit(1, 'You must provide a name for your sandbox.');
      }

      // if --rules is specified, then either --property or --hostname must be specified
      if (papiFilePath) {
        if (!oneOf(propertySpecifier, hostnameSpecifier)) {
          cliUtils.logAndExit(1, 'Either --property or --hostname must be specified to base the created sandbox on when --rules is specified.');
        }
        if (propertySpecifier) {
          propForRules = parsePropertySpecifier(propertySpecifier);
        } else {
          propForRules = parseHostnameSpecifier(hostnameSpecifier);
        }
      }

      const hostnames = hostnamesCsv ? parseHostnameCsv(hostnamesCsv) : undefined;

      let r = null;
      if (papiFilePath) {
        r = await createFromRules(papiFilePath, propForRules, hostnames, isClonable, name, cpCode);
      } else if (propertySpecifier) {
        r = await createFromProperty(propertySpecifier, hostnames, isClonable, name, cpCode);
      } else if (hostnameSpecifier) {
        r = await createFromHostname(hostnameSpecifier, hostnames, isClonable, name, cpCode);
      } else {
        return cliUtils.logAndExit(1, 'Exactly one of the following must be specified : ' +
          '--property, --hostname. Choose one of those arguments.')
      }

      await registerSandbox(r.sandboxId, r.jwtToken, name, options.originFrom);

    } catch (e) {
      handleException(e);
    }
  });

program
  .command('start')
  .description('Starts the sandbox client.')
  .option('--print-logs', 'Print logs to standard output.')
  .action(async function(options) {
    try {
      if (sandboxClientManager.getAllSandboxes().length == 0) {
        console.log('there are no sandboxes configured');
      } else {
        await downloadClientIfNecessary();
        await sandboxClientManager.executeSandboxClient(!!options.printLogs);
      }
    } catch (e) {
      handleException(e);
    }
  });

program
  .command('add-property [sandbox-id]')
  .description('Adds a property to the sandbox.')
  .option('-r, --rules <file>', 'JSON file containing a PAPI rule tree.')
  .option('-p, --property <property-id | property-name:version>', 'Property to use. If you do not specify a version, the most recent version is used.')
  .option('-o, --hostname <hostname>', 'The hostname of your Akamai property, such as www.example.com.')
  .option('-C, --cpcode <cpcode>', 'Specify an existing cpcode instead of letting the system generate a new one.')
  .option('-H, --requesthostnames <string>', 'Comma separated list of request hostnames.')
  .action(async function(arg, options) {
    helpExitOnNoArgs(options);
    try {
      const papiFilePath = options.rules;
      const propertySpecifier = options.property;
      const hostnameSpecifier = options.hostname;
      const cpCode = options.cpcode;
      const hostnamesCsv = options.requesthostnames;

      let sandboxId;
      if (!arg) {
        sandboxId = sandboxClientManager.getCurrentSandboxId();
        if (!sandboxId) {
          cliUtils.logAndExit(1, 'Unable to determine sandbox-id.');
        }
      } else {
        sandboxId = getSandboxIdFromIdentifier(arg);
      }

      if (!oneOf(propertySpecifier, papiFilePath, hostnameSpecifier)) {
        cliUtils.logAndExit(1, 'You need to specify exactly one of these arguments: --property, --rules, --hostname. Choose one.')
      }

      if (!hostnamesCsv && papiFilePath) {
        cliUtils.logAndExit(1, 'If you use the --rules method, you need to specify --requesthostnames for the sandbox.');
      }
      const hostnames = hostnamesCsv ? parseHostnameCsv(hostnamesCsv) : undefined;

      await addPropertyToSandbox(sandboxId, propertySpecifier, papiFilePath, hostnameSpecifier, hostnames, cpCode);
    } catch (e) {
      handleException(e);
    }
  });

program
  .command('sync-sandbox <JWT>')
  .description('Syncs a remote sandbox with the local system.')
  .option('-n, --name <string>', 'Recommended to use the sandbox name provided during creation. If sandbox folder name already exists locally, custom sandbox name can be provided.')
  .option('--origin-from <property | config>', 'Redirect origin traffic to the origins defined in your Akamai property or config file.')
  .action(async function(jwt, options) {
    helpExitOnNoArgs(options);
    validateArgument('--origin-from', options.originFrom, [OriginMapping.FROM_CONFIG, OriginMapping.FROM_PROPERTY]);

    sandboxSvc.setAccountWide(true);
    try {
      let sandboxName;
      const decodedJwt: object = jwtDecode(jwt);
      const sandboxId = decodedJwt[`sandboxID`];
      if (sandboxId === undefined) {
        cliUtils.logAndExit(1, 'Could not find sandboxID in the provided JWT');
      }
      let localMatchedSandboxName = null;
      let matchedLocalSandbox = sandboxClientManager.getAllSandboxes().some(sandbox => {
        if (sandbox.sandboxId == sandboxId) {
          localMatchedSandboxName = sandbox.name;
          return true;
        }
      });
      if (matchedLocalSandbox) {
        cliUtils.logAndExit(0, `\nAborting Sync...\nThe sandbox with sandbox id : ${sandboxId} and sandbox name ${localMatchedSandboxName} is already synced locally. Further syncs are not required for further updates to this sandbox.`);
      }
      console.log(`Syncing sandbox with sandbox-id : ${sandboxId}`);
      if (isNonEmptyString(options.name)) {
        sandboxName = options.name
      } else {
        let sandbox = await sandboxSvc.getSandbox(sandboxId);
        sandboxName = sandbox['name'];
        console.log(`Fetched Sandbox Name : ${sandboxName} from the provided JWT`);
      }

      const hasSandboxName = await sandboxClientManager.hasSandboxFolder(sandboxName);
      if (!hasSandboxName) {
        await registerSandbox(sandboxId, jwt, sandboxName, options.originFrom);
      } else {
        cliUtils.logAndExit(1, `Sandbox folder name ${sandboxName} already exists locally. Please provide a different sandbox name for this local sandbox folder using option -n or --name.`)
      }
    } catch (e) {
      handleException(e);
    }
    sandboxSvc.setAccountWide(false);
  });

program
  .command('rotate-jwt [sandbox-id]')
  .description('Rotates the JWT for the sandbox.')
  .action(async function(arg) {
    try {
      let sandboxId;
      if (!arg) {
        sandboxId = sandboxClientManager.getCurrentSandboxId();
        if (!sandboxId) {
          cliUtils.logAndExit(1, 'Unable to determine sandbox-id.');
        }
      } else {
        sandboxId = getSandboxIdFromIdentifier(arg);
      }
      const result = await cliUtils.spinner(sandboxSvc.rotateJWT(sandboxId), 'rotating JWT');
      await sandboxClientManager.updateJWT(sandboxId, result.jwtToken);
      console.log(`Successfully rotated a JWT for sandbox-id: ${sandboxId}`);
      console.log(`The new token expires on ${jwtExpirationDateString(result.jwtToken)}`);
    } catch (e) {
      handleException(e);
    }
  });

program
  .command('add-edgeworker <edgeworker-id> <edgeworker-tarball>')
  .description('Adds an edgeworker to the default sandbox. Use a positive integer for edgeworker-id.')
  .action(async function(edgeworkerId, edgeworkerTarballPath, options) {
    helpExitOnNoArgs(options);
    await addOrUpdateEdgeWorker(edgeworkerId, edgeworkerTarballPath, 'add');
  });

program
  .command('update-edgeworker <edgeworker-id> <edgeworker-tarball>')
  .description('Updates the edgeworker for the default sandbox.')
  .action(async function(edgeworkerId, edgeworkerTarballPath, options) {
    helpExitOnNoArgs(options);
    await addOrUpdateEdgeWorker(edgeworkerId, edgeworkerTarballPath, 'update');
  });

program
  .command('download-edgeworker <edgeworker-id>')
  .description('Downloads the edgeworker for the default sandbox.')
  .action(async function(edgeworkerId, options) {
    helpExitOnNoArgs(options);
    try {
      let sandboxId = sandboxClientManager.getCurrentSandboxId();
      if (!sandboxId) {
        cliUtils.logAndExit(1, 'Unable to determine sandbox-id');
      }
      let hexFile = await pullEdgeWorkerFromSandbox(sandboxId, edgeworkerId);

      await makeFileForEdgeworker(edgeworkerId, hexFile);
    } catch (e) {
      handleException(e);
    }
  });

program
  .command('delete-edgeworker <edgeworker-id>')
  .description('Deletes the edgeworker for the default sandbox.')
  .option('-f, --force', 'Attempt to remove the edgeworker without prompting for confirmation.')
  .action(async function(edgeworkerId, options) {
    helpExitOnNoArgs(options);
    try {
      const forceDelete = !!options.force;
      const sandboxId = sandboxClientManager.getCurrentSandboxId();

      if (!forceDelete) {
        if (!await cliUtils.confirm(
          `Are you sure you want to delete the edgeworker with id: ${edgeworkerId} for the currently active sandbox : ${sandboxId} `)) {
          return;
        }
      }
      if (!sandboxId) {
        cliUtils.logAndExit(1, 'Unable to determine sandbox-id');
      }
      await deleteEdgeWorkerFromSandbox(sandboxId, edgeworkerId);
      console.log('done!');

    } catch (e) {
      handleException(e);
    }
  });

if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit();
}

program.parse(process.argv);
