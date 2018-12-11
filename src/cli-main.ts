#!/usr/bin/env node
import * as fs from 'fs';
import * as path from "path";
import * as os from "os";

const uuidv1 = require('uuid/v1');

const CLI_CACHE_PATH = process.env.AKAMAI_CLI_CACHE_PATH;

if (!CLI_CACHE_PATH) {
  logAndExit("error AKAMAI_CLI_CACHE_PATH is not set");
}

if (!fs.existsSync(CLI_CACHE_PATH)) {
  logAndExit(`AKAMAI_CLI_CACHE_PATH is set to ${CLI_CACHE_PATH} but this directory does not exist`);
}

const edgeRcPath = path.resolve(os.homedir(), '.edgerc');
if (!fs.existsSync(edgeRcPath)) {
  logAndExit(`Couldn't find .edgerc for Akamai {OPEN} client. Please configure your .edgerc file at this path: ${edgeRcPath}`);
}

import * as envUtils from './utils/env-utils';
import * as cliUtils from './utils/cli-utils';
import * as sandboxClientManager from './service/sandbox-client-manager';
import * as sandboxSvc from './service/sandbox-svc'

if (envUtils.getNodeVersion() < 8) {
  logAndExit("The Akamai Sandbox CLI requires Node 8 or later.");
}

const util = require('util');
const validator = require('validator');
const pkginfo = require('../package.json');

const cTable = require('console.table');

const Validator = require('jsonschema').Validator;
const jsonSchemaValidator = new Validator();
const recipeFileSchema = require('../schemas/recipe.json');
const clientConfigSchema = require('../schemas/client-config.json');
jsonSchemaValidator.addSchema(clientConfigSchema, '#clientConfig');

function validateSchema(json) {
  return jsonSchemaValidator.validate(json, recipeFileSchema);
}

function logAndExit(msg: string) {
  console.log(msg);
  process.exit();
}

function readFileAsString(path) {
  var data = fs.readFileSync(path);
  return data.toString();
}

var program = require('commander');

program
  .version(pkginfo.version)
  .description(pkginfo.description)
  .option('--debug', 'show debug information')
  .option('--edgerc <path>', 'use edgerc file for command')
  .option('--section <name>', 'use this section in edgerc file')
  .option('--accountkey <account-id>', 'internal parameter')
  .on("option:edgerc", function (edgeRcFilePath) {
    envUtils.setEdgeRcFilePath(edgeRcFilePath);
  })
  .on("option:section", function (section) {
    envUtils.setEdgeRcSection(section);
  })
  .on("option:accountkey", function (key) {
    sandboxSvc.setAccountKey(key);
  })
  .on("option:debug", function () {
    envUtils.setDebugMode(true);
  });

program
  .command('help [command]')
  .description('shows help information for the given command.')
  .action(function (arg) {
    if (!arg) {
      program.outputHelp();
    } else {
      var command = program.commands.find(c => c._name == arg);
      if (!command) {
        console.log(`Couldn't find a command for ${arg}`);
      } else {
        command.outputHelp();
      }
    }
  });

program
  .command('install')
  .description('downloads and installs the devpops client software')
  .action(async function (dir, cmd) {
    try {
      if (sandboxClientManager.isAlreadyInstalled()) {
        console.log("already installed");
      } else {
        await downloadClientIfNecessary();
      }
    } catch (e) {
      console.error(e);
    }
  });

function showLocalSandboxes() {
  console.log("Local sandboxes:\n");
  var sandboxes = sandboxClientManager.getAllSandboxes().map(sb => {
    return {
      current: sb.current ? "YES" : "",
      name: sb.name,
      sandbox_id: sb.sandboxId
    }
  });
  showSandboxesTable(sandboxes);
}

function showSandboxesTable(sandboxes) {
  if (sandboxes.length === 0) {
    console.log('no sandboxes found');
  } else {
    console.table(sandboxes);
  }
}

async function showRemoteSandboxes() {
  console.log("Loading sandboxes (via OPEN): \n");
  var localIds = new Set();
  sandboxClientManager.getAllSandboxes().forEach(sb => localIds.add(sb.sandboxId));
  var result = await cliUtils.spinner(sandboxSvc.getAllSandboxes());
  var sandboxes = result.sandboxes.map(sb => {
    return {
      has_local: localIds.has(sb.sandboxId) ? "Y" : "N",
      name: sb.name,
      sandbox_id: sb.sandboxId,
      status: sb.status
    }
  });
  showSandboxesTable(sandboxes);
}

program
  .command('list')
  .alias('ls')
  .description('lists sandboxes that you have managed locally')
  .option('-r, --remote', 'show sandboxes from the server')
  .action(async function (options) {
    try {
      if (options.remote) {
        await showRemoteSandboxes();
      } else {
        showLocalSandboxes();
      }
    } catch (e) {
      console.error(e);
    }
  });

async function getRulesForSandboxId(sandboxId: string) {
  var sandbox: any = await cliUtils.spinner(sandboxSvc.getSandbox(sandboxId));
  var pIds = sandbox.properties.map(p => p.sandboxPropertyId);
  var r = [];

  for (var pid of pIds) {
    var obj: any = await cliUtils.spinner(sandboxSvc.getRules(sandboxId, pid));
    r.push({
      title: `sandbox_property_id: ${pid}`,
      rules: obj.rules
    });
  }
  return r;
}

function populateOrigins(papiNode, originsList) {
  if (papiNode == null) {
    return;
  }
  papiNode.behaviors
    .filter(b => b.name === 'origin')
    .filter(b => b.options && b.options.hostname)
    .forEach(b => {
      originsList.push(b.options.hostname);
    });

  papiNode.children.forEach(c => {
    populateOrigins(c, originsList);
  });
}

function getOriginsForPapiRules(papiRules) {
  var o = [];
  populateOrigins(papiRules, o);
  return o;
}

async function showSandboxOverview(sandboxId: string) {
  var localSandbox = sandboxClientManager.getSandboxLocalData(sandboxId);
  if (localSandbox) {
    cliUtils.logWithBorder("Local sandbox information:");
    console.log("sandbox_id: " + sandboxId);
    console.log("local directory: " + localSandbox.sandboxFolder);
    console.log(`current: ${localSandbox.isCurrent}\n`);
  }
  var sandbox = await cliUtils.spinner(sandboxSvc.getSandbox(sandboxId));

  cliUtils.logWithBorder("Detailed Info (via OPEN):");

  console.log(`name: ${sandbox.name}`);
  console.log(`created by: ${sandbox.createdBy}`);
  console.log(`is_clonable: ${sandbox.isClonable}`);
  console.log(`status: ${sandbox.status}\n`);

  cliUtils.logWithBorder("Sandbox Properties");

  sandbox.properties.forEach(p => {
    console.log("sandboxPropertyId: " + p.sandboxPropertyId);
    console.log(`requestHostname(s): ${p.requestHostnames.join(', ')}\n`);
  });
}

program
  .command('show [sandbox-identifier]')
  .description('shows details about a sandbox')
  .action(async function (arg, cmd) {
    try {
      var sandboxIdToUse = null;
      if (!arg) {
        if (sandboxClientManager.hasCurrent()) {
          sandboxIdToUse = sandboxClientManager.getCurrentSandboxId();
        } else {
          logAndExit('Unable to determine sandbox_id');
        }
      } else {
        sandboxIdToUse = getSandboxIdFromIdentifier(arg);
      }
      await showSandboxOverview(sandboxIdToUse);
    } catch (e) {
      console.error(e);
    }
  });

program
  .command('rules [sandbox-identifier]')
  .description('shows papi rules for sandbox')
  .action(async function (arg, cmd) {
    try {
      var sandboxIdToUse = null;
      if (!arg) {
        if (sandboxClientManager.hasCurrent()) {
          sandboxIdToUse = sandboxClientManager.getCurrentSandboxId();
        } else {
          logAndExit('Unable to determine sandbox_id');
        }
      } else {
        sandboxIdToUse = getSandboxIdFromIdentifier(arg);
      }
      var rulesList = await getRulesForSandboxId(sandboxIdToUse);
      rulesList.forEach(o => {
        cliUtils.logWithBorder(o.title, 'err');
        console.log(cliUtils.toJsonPretty(o.rules));
      })
    } catch (e) {
      console.error(e);
    }
  });

function getLocalSandboxForIdentifier(identifier: string, failOnNoResult = true) {
  var results = sandboxClientManager.searchLocalSandboxes(identifier);
  if (results.length == 0) {
    if (failOnNoResult) {
      logAndExit(`could not find any local sandboxes matching input: ${identifier}`)
    } else {
      return null;
    }
  } else if (results.length > 1) {
    logAndExit(`${results.length} local sandboxes match input. Please be more specific.`);
  } else {
    return results[0];
  }
}

function orCurrent(sandboxIdentifier) {
  if (sandboxIdentifier) {
    return sandboxIdentifier;
  }
  if (!sandboxClientManager.hasCurrent()) {
    return 'no current sandboxId. Please specify a sandboxId.';
  }
  return sandboxClientManager.getCurrentSandboxId();
}

function getSandboxIdFromIdentifier(sandboxIdentifier: string) {
  var sb = getLocalSandboxForIdentifier(sandboxIdentifier, false);
  if (sb) {
    return sb.sandboxId;
  } else {
    return sandboxIdentifier;
  }
}

program
  .command('use <sandbox-identifier>')
  .description('sets the sandbox as currently active sandbox')
  .action(function (arg, options) {
    var sb = getLocalSandboxForIdentifier(arg);
    sandboxClientManager.makeCurrent(sb.sandboxId);
    console.log(`Sandbox: ${sb.name} is now active`)
  });

program
  .command('delete <sandbox-identifier>')
  .description('deletes this sandbox')
  .action(async function (arg, options) {
    try {
      var results = sandboxClientManager.searchLocalSandboxes(arg);
      if (results.length > 1) {
        logAndExit(`${results.length} match input. Please be more specific.`);
      } else {
        if (!await cliUtils.confirm('are you sure you want to delete this sandbox?')) {
          return;
        }

        if (results.length == 1) {
          var sb = results[0];
          var progressMsg = `deleting sandboxId: ${sb.sandboxId} name: ${sb.name}`;
          await cliUtils.spinner(sandboxSvc.deleteSandbox(sb.sandboxId), progressMsg);
          console.log("removing local files");
          sandboxClientManager.flushLocalSandbox(sb.sandboxId);
        } else {
          var msg = `deleting sandboxId: ${arg}`;
          await cliUtils.spinner(sandboxSvc.deleteSandbox(arg), msg);
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

function parseToBoolean(str: string) {
  if (!str) {
    return false;
  }
  var r = str.trim().toLowerCase();
  var strToBool = new Map([
    ['true', true],
    ['t', true],
    ['y', true],
    ['yes', true],
    ['false', false],
    ['f', false],
    ['n', false],
    ['no', false],
  ]);
  if (!strToBool.has(str)) {
    logAndExit(`unable to determine boolean from input: ${str} please use y/n`)
  } else {
    return strToBool.get(str);
  }
}

program
  .command('update-property <sandbox-id> <sandbox-property-id>')
  .description('updates a sandbox-property')
  .option('-r, --rules <file>', 'papi json file')
  .option('-H, --requesthostnames <string>', 'comma separated list of request hostnames')
  .action(async function (sandboxId, sandboxPropertyId, options) {
    var rules = options.rules;
    var requestHostnames = options.requesthostnames;
    try {
      await updateHostnamesAndRules(requestHostnames, rules, sandboxId, sandboxPropertyId);
      console.log(`successfully updated sandbox_id: ${sandboxId} sandbox_property_id: ${sandboxPropertyId}`);
    } catch (e) {
      console.log(e);
    }
  });

async function updateHostnamesAndRules(requestHostnames, rulesFilePath, sandboxId, sandboxPropertyId) {
  if (requestHostnames) {
    const property = await cliUtils.spinner(sandboxSvc.getProperty(sandboxId, sandboxPropertyId), `loading sandboxPropertyId: ${sandboxPropertyId}`);
    property.requestHostnames = parseHostnameCsv(requestHostnames);
    await cliUtils.spinner(sandboxSvc.updateProperty(sandboxId, property), `updating sandboxPropertyId: ${sandboxPropertyId}`);
  }
  if (rulesFilePath) {
    const rules = getJsonFromFile(rulesFilePath);
    await cliUtils.spinner(sandboxSvc.updateRules(sandboxId, sandboxPropertyId, rules), 'updating rules');
  }
}

program
  .command('update [sandbox-identifier]')
  .description('updates a sandbox')
  .option('-r, --rules <file>', 'papi json file')
  .option('-c, --clonable <boolean>', 'make this sandbox clonable (Y/N)')
  .option('-n, --name <string>', 'name of sandbox')
  .option('-H, --requesthostnames <string>', 'comma separated list of request hostnames')
  .option('--recipe <path>', 'path to recipe json file')
  .action(async function (arg, options) {
    helpExitOnNoArgs(options);
    try {
      const clonable = parseToBoolean(options.clonable);
      const sandboxId = getSandboxIdFromIdentifier(orCurrent(arg));
      const recipeFilePath = options.recipe;
      if (recipeFilePath) {
        await updateFromRecipe(sandboxId, recipeFilePath, options.name, clonable);
        return;
      }
      const sandbox = await cliUtils.spinner(sandboxSvc.getSandbox(sandboxId), `loading sandboxId: ${sandboxId}`);
      if (options.clonable) {
        sandbox.isClonable = clonable;
      }
      if (options.name) {
        sandbox.name = options.name;
      }

      await cliUtils.spinner(sandboxSvc.updateSandbox(sandbox), `updating sandbox_id: ${sandbox.sandboxId}`);

      const propertyChange: boolean = !!options.requesthostnames || !!options.rules;
      if (propertyChange && sandbox.properties.length > 1) {
        logAndExit(`Unable to update property as multiple were found (${sandbox.properties.length}). Please use update-property.`);
      }
      const sandboxPropertyId = sandbox.properties[0].sandboxPropertyId;
      await updateHostnamesAndRules(options.requesthostnames, options.rules, sandboxId, sandboxPropertyId);
      console.log(`successfully updated sandbox_id: ${sandboxId}`)
    } catch (e) {
      console.log(e);
    }
  });

function getJsonFromFile(papiFilePath) {
  try {
    return JSON.parse(readFileAsString(papiFilePath));
  } catch (ex) {
    console.error('JSON file is invalid ' + ex);
    throw ex;
  }
}

function parseHostnameCsv(csv) {
  return csv.split(',')
    .map(hn => hn.trim().toLowerCase())
    .filter(hn => hn.length > 0);
}

program
  .command('clone <sandbox-identifier>')
  .description('clones a sandbox')
  .option('-n, --name <string>', 'name of sandbox')
  .action(async function (arg, options) {
    try {
      const sandboxId = getSandboxIdFromIdentifier(arg);
      if (!options.name) {
        logAndExit('parameter --name is required');
      }
      const name = options.name;
      const cloneResponse = await cliUtils.spinner(sandboxSvc.cloneSandbox(sandboxId, name));

      await registerSandbox(cloneResponse.sandboxId, cloneResponse.jwtToken, name);
    } catch (e) {
      console.log(e);
    }
  });

async function addPropertyFromRules(sandboxId: string, papiFilePath: string, hostnames: Array<string>) {
  if (!fs.existsSync(papiFilePath)) {
    logAndExit(`file: ${papiFilePath} does not exist`);
  }
  const papiJson = getJsonFromFile(papiFilePath);
  return await cliUtils.spinner(sandboxSvc.addPropertyFromRules(sandboxId, hostnames, papiJson), `adding sandbox property to ${sandboxId}`);
}

async function createFromRules(papiFilePath: string, hostnames: Array<string>, isClonable: boolean, name: string) {
  if (!fs.existsSync(papiFilePath)) {
    logAndExit(`file: ${papiFilePath} does not exist`);
  }
  const papiJson = getJsonFromFile(papiFilePath);
  return await cliUtils.spinner(sandboxSvc.createFromRules(papiJson, hostnames, name, isClonable), "creating new sandbox");
}

function parsePropertySpecifier(propertySpecifier) {
  var propertySpec;
  var propertyVersion;
  if (propertySpecifier.indexOf(':') > -1) {
    var parts = propertySpecifier.split(':').map(s => s.trim().toLowerCase());
    propertySpec = parts[0];
    propertyVersion = parts[1];
  } else {
    propertySpec = propertySpecifier.trim().toLowerCase();
  }

  if (propertyVersion && !validator.isInt(propertyVersion, {min: 1})) {
    logAndExit(`property_version: ${propertyVersion} must be an integer > 0`);
  }

  const propertySpecObj: any = {};
  var key;
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

async function addPropertyToSandboxFromProperty(sandboxId: string, hostnames: Array<string>, propertySpecifier: string) {
  const propertySpecObj = parsePropertySpecifier(propertySpecifier);
  const msg = `adding property from: ${JSON.stringify(propertySpecObj)}`;
  return await cliUtils.spinner(sandboxSvc.addPropertyFromProperty(sandboxId, hostnames, propertySpecObj), msg);
}

async function addPropertyToSandboxFromHostname(sandboxId: string, hostnames: Array<string>, hostname: string) {
  const msg = `adding property based on: ${hostname}`;
  return await cliUtils.spinner(sandboxSvc.addPropertyFromProperty(sandboxId, hostnames, {hostname}), msg);
}

async function createFromProperty(propertySpecifier: string, hostnames: Array<string>, isClonable: boolean, name: string) {
  const propertySpecObj = parsePropertySpecifier(propertySpecifier);
  const msg = `Creating from: ${JSON.stringify(propertySpecObj)}`;
  return await cliUtils.spinner(sandboxSvc.createFromProperty(hostnames, name, isClonable, propertySpecObj), msg);
}

async function createFromHostname(hostname: string, hostnames: Array<string>, isClonable: boolean, name: string) {
  const msg = `Creating from: ${hostname}`;
  return await cliUtils.spinner(sandboxSvc.createFromProperty(hostnames, name, isClonable, {hostname}), msg);
}

async function getOriginListForSandboxId(sandboxId: string): Promise<Array<string>> {
  var rulesList = await getRulesForSandboxId(sandboxId);
  const origins = new Set();
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

async function createFromPropertiesRecipe(recipe) {
  const sandboxRecipe = recipe.sandbox;
  const properties = sandboxRecipe.properties;

  const firstProp = properties[0];
  console.log(`creating sandbox & property 1 from recipe`);
  const r = await cliUtils.spinner(createRecipeSandboxAndProperty(firstProp, sandboxRecipe));

  for (var i = 1; i < properties.length; i++) {
    try {
      console.log(`creating property ${i + 1} from recipe`);
      await cliUtils.spinner(createRecipeProperty(properties[i], r.sandboxId));
    } catch (e) {
      console.error(e);
    }
  }
  return r;
}

function createFromCloneRecipe(recipe) {
  const cloneFrom = recipe.sandbox.cloneFrom;
  if (!cloneFrom) {
    logAndExit('missing sandbox.cloneFrom');
  }
  const sandboxId = cloneFrom.sandboxId;
  if (!sandboxId) {
    logAndExit('missing cloneFrom.sandboxId');
  }
  const clonable = cloneFrom.clonable;
  return sandboxSvc.cloneSandbox(sandboxId, recipe.sandbox.name, clonable);
}

function validateAndBuildRecipe(recipeFilePath, name, clonable): any {
  if (typeof name !== 'string') {
    name = null;
  }
  console.log('validating recipe file');
  if (!fs.existsSync(recipeFilePath)) {
    logAndExit(`File ${recipeFilePath} does not exist.`);
  }
  const recipe = getJsonFromFile(recipeFilePath);
  var r = validateSchema(recipe);
  if (r.errors.length > 0) {
    logAndExit(`there are problems with your recipe file\n ${r}`);
  }
  const sandboxRecipe = recipe.sandbox;
  sandboxRecipe.clonable = clonable || sandboxRecipe.clonable;
  sandboxRecipe.name = name || sandboxRecipe.name;
  if (sandboxRecipe.properties) {
    sandboxRecipe.properties.forEach(p => {
      if (p.rulesPath) {
        p.rulesPath = resolveRulesPath(recipeFilePath, p.rulesPath);
      }
    });
    var idx = 0;
    sandboxRecipe.properties.forEach(p => {
      if (!oneOf(p.rulesPath, p.property, p.hostname)) {
        logAndExit(`Error with property ${idx}. Please specify only one of: rulesPath, property, or hostname`);
      }
      if (p.rulesPath && !fs.existsSync(p.rulesPath)) {
        logAndExit(`Error with property ${idx} could not load file at path: ${p.rulesPath}`);
      }
      if (p.rulesPath && (!p.requestHostnames || p.requestHostnames.length === 0)) {
        logAndExit(`Error with property ${idx}. Must specify requestHostnames array when using rulesPath`);
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
    logAndExit('Update command is unsupported with cloneFrom recipe');
  }

  if (!sandboxRecipe.properties) {
    logAndExit('Missing properties unable to perform operation');
  }
  console.log(`loading information for sandbox_id: ${sandboxId}`);
  const sandbox: any = await cliUtils.spinner(sandboxSvc.getSandbox(sandboxId));
  sandbox.isClonable = recipe.clonable;
  sandbox.name = recipe.name;

  console.log(`updating sandbox information for sandbox_id: ${sandboxId}`);
  await sandboxSvc.updateSandbox(sandbox);

  var pIds = sandbox.properties.map(p => p.sandboxPropertyId);
  const first = pIds[0];
  for (var i = 1; i < pIds.length; i++) {
    const propertyId = pIds[i];
    console.log(`deleting sandbox_property_id: ${propertyId}`);
    await cliUtils.spinner(sandboxSvc.deleteProperty(sandboxId, propertyId));
  }

  const propertyObj = {
    sandboxPropertyId: first,
    requestHostnames: [uuidv1()]
  };

  console.log(`updating sandbox_property_id: ${first}`);
  await cliUtils.spinner(sandboxSvc.updateProperty(sandboxId, propertyObj));

  for (var i = 0; i < sandboxRecipe.properties.length; i++) {
    const rp = sandboxRecipe.properties[i];
    console.log(`re-building property: ${i + 1}`);
    await cliUtils.spinner(createRecipeProperty(rp, sandboxId));
  }

  console.log(`deleting sandbox_property_id: ${first}`);
  await cliUtils.spinner(sandboxSvc.deleteProperty(sandboxId, first));
}


async function createFromRecipe(recipeFilePath, name, clonable) {
  const recipe = validateAndBuildRecipe(recipeFilePath, name, clonable);

  const sandboxRecipe = recipe.sandbox;

  var res = null;
  if (sandboxRecipe.properties) {
    res = await createFromPropertiesRecipe(recipe);
  } else if (sandboxRecipe.cloneFrom) {
    res = await createFromCloneRecipe(recipe);
  } else {
    logAndExit("Error: couldn't find either sandbox.properties or sandbox.cloneFrom");
  }

  await registerSandbox(res.sandboxId,
    res.jwtToken,
    typeof sandboxRecipe.name === 'string' ? sandboxRecipe.name : res.sandboxId,
    recipe.clientConfig);
}

function createRecipeProperty(rp, sandboxId) {
  if (rp.property) {
    return addPropertyToSandboxFromProperty(sandboxId, rp.requestHostnames, rp.property);
  } else if (rp.rulesPath) {
    return addPropertyFromRules(sandboxId, rp.rulesPath, rp.requestHostnames);
  } else if (rp.hostname) {
    return addPropertyToSandboxFromHostname(sandboxId, rp.requestHostnames, rp.hostname);
  } else {
    logAndExit("critical error with recipe property. rulesPath or property needs to be defined.");
  }
}

function createRecipeSandboxAndProperty(rp, recipe) {
  if (rp.property) {
    return createFromProperty(rp.property, rp.requestHostnames, recipe.clonable, recipe.name);
  } else if (rp.hostname) {
    return createFromHostname(rp.hostname, rp.requestHostnames, recipe.clonable, recipe.name);
  } else if (rp.rulesPath) {
    return createFromRules(rp.rulesPath, rp.requestHostnames, recipe.clonable, recipe.name);
  } else {
    logAndExit("critical error with recipe property. rulesPath or property needs to be defined.");
  }
}

function oneOf(...args: any[]) {
  var r = false;
  for (var i = 0; i < args.length; i++) {
    if (args[i]) {
      if (r) {
        return false;
      }
      r = true;
    }
  }
  return r;
}

program
  .command('create')
  .description('create a new sandbox')
  .option('-r, --rules <file>', 'papi json file')
  .option('-p, --property <property_id | property_name : version>', 'property to use. if no version is specified the latest will be used.')
  .option('-o, --hostname <hostname>', 'the hostname of your akamai property (e.g. www.example.com)')
  .option('-c, --clonable <boolean>', 'make this sandbox clonable')
  .option('-n, --name <string>', 'name of sandbox')
  .option('-H, --requesthostnames <string>', 'comma separated list of request hostnames')
  .option('--recipe <path>', 'path to recipe json file')
  .action(async function (options) {
    helpExitOnNoArgs(options);
    try {
      const recipePath = options.recipe;
      if (recipePath) {
        await createFromRecipe(recipePath, options.name, options.clonable);
        return;
      }

      const papiFilePath = options.rules;
      const name = options.name;
      const hostnamesCsv = options.requesthostnames;
      const isClonable = parseToBoolean(options.clonable);

      const propertySpecifier = options.property;
      const hostnameSpecifier = options.hostname;

      //validation
      if (!name) {
        logAndExit(`You must provide a name for your sandbox`);
      }
      if (!oneOf(propertySpecifier, papiFilePath, hostnameSpecifier)) {
        logAndExit(`Exactly one of the following must be specified: --property, --rules, --hostname. Please pick only one of those arguments.`)
      }

      if (!hostnamesCsv && papiFilePath) {
        logAndExit('--requesthostnames must be specified when specifying --rules');
      }
      const hostnames = hostnamesCsv ? parseHostnameCsv(hostnamesCsv) : undefined;

      var r = null;
      if (papiFilePath) {
        r = await createFromRules(papiFilePath, hostnames, isClonable, name);
      } else if (propertySpecifier) {
        r = await createFromProperty(propertySpecifier, hostnames, isClonable, name);
      } else if (hostnameSpecifier) {
        r = await createFromHostname(hostnameSpecifier, hostnames, isClonable, name);
      }

      await registerSandbox(r.sandboxId, r.jwtToken, name);

    } catch (e) {
      console.log(e);
    }
  });

async function registerSandbox(sandboxId: string, jwt: string, name: string, clientConfig = null) {
  console.log('building origin list');
  var origins: Array<string> = await getOriginListForSandboxId(sandboxId);
  var passThrough = false;
  if (origins.length > 0) {
    console.log(`Detected the following origins: ${origins.join(', ')}`);
    if (await cliUtils.confirm('Would you like the Sandbox Client to proxy these to the destination defined in the Akamai config?')) {
      passThrough = true;
    }
  }

  console.log('registering sandbox in local datastore');
  var registration = sandboxClientManager.registerNewSandbox(sandboxId, jwt, name, origins, clientConfig, passThrough);

  console.info(`Successfully created sandbox_id ${sandboxId}. Generated sandbox client configuration at ${registration.configPath} please edit this file`);
}

async function downloadClientIfNecessary() {
  try {
    if (!sandboxClientManager.isAlreadyInstalled()) {
      console.log("no sandbox client installed. Installing sandbox client...");
      await sandboxClientManager.downloadClient();
    }
  } catch (e) {
    console.log('Critical error: got exception during client download: ' + e);
    process.exit();
  }
}

program
  .command('start')
  .description('starts the sandbox client')
  .action(async function (dir, cmd) {
    try {
      if (sandboxClientManager.getAllSandboxes().length == 0) {
        console.log('there are no sandboxes configured');
      } else {
        await downloadClientIfNecessary();
        await sandboxClientManager.executeSandboxClient();
      }
    } catch (e) {
      console.error(e);
    }
  });

function helpExitOnNoArgs(cmd) {
  var len = process.argv.slice(2).length;
  if (!len || len <= 1) {
    cmd.outputHelp();
    process.exit();
  }
}

if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit();
}

program.parse(process.argv);
