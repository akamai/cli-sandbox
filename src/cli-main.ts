#!/usr/bin/env node
import * as fs from 'fs';
import * as path from "path";

const uuidv1 = require('uuid/v1');
const jwtDecode = require('jwt-decode');

const CLI_CACHE_PATH = process.env.AKAMAI_CLI_CACHE_PATH;

if (!CLI_CACHE_PATH) {
  cliUtils.logAndExit(1, "ERROR: AKAMAI_CLI_CACHE_PATH is not set.");
}

if (!fs.existsSync(CLI_CACHE_PATH)) {
  cliUtils.logAndExit(1, `ERROR: AKAMAI_CLI_CACHE_PATH is set to ${CLI_CACHE_PATH} but this directory does not exist.`);
}

import * as envUtils from './utils/env-utils';
import * as cliUtils from './utils/cli-utils';
import * as sandboxClientManager from './service/sandbox-client-manager';
import * as sandboxSvc from './service/sandbox-svc'

if (envUtils.getNodeVersion() < 8) {
  cliUtils.logAndExit(1,"ERROR: The Akamai Sandbox CLI requires Node 8 or later.");
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

function readFileAsString(path) {
  var data = fs.readFileSync(path);
  return data.toString();
}

var program = require('commander');

program
  .version(pkginfo.version)
  .description(pkginfo.description)
  .option('--debug', 'Show debug information.')
  .option('--edgerc <path>', 'Use edgerc file for authentication.')
  .option('--section <name>', 'Use this section in edgerc file that contains the credential set.')
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
  .description('Displays help information for the given command.')
  .action(function (arg) {
    if (!arg) {
      program.outputHelp();
    } else {
      var command = program.commands.find(c => c._name == arg);
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
  .action(async function (dir, cmd) {
    try {
      if (sandboxClientManager.isAlreadyInstalled()) {
        console.log("Sandbox Client is already installed.");
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
    console.log('No sandboxes found.');
  } else {
    console.table(sandboxes);
  }
}

async function showRemoteSandboxes() {
  console.log("Loading sandboxes: \n");
  var localIds = new Set();
  sandboxClientManager.getAllSandboxes().forEach(sb => localIds.add(sb.sandboxId));
  const allSandboxesResult = await cliUtils.spinner(sandboxSvc.getAllSandboxes());
  const quota = allSandboxesResult.quota;
  var sandboxes = allSandboxesResult.result.sandboxes.map(sb => {
    return {
      has_local: localIds.has(sb.sandboxId) ? "Y" : "N",
      name: sb.name,
      sandbox_id: sb.sandboxId,
      status: sb.status
    }
  });
  showSandboxesTable(sandboxes);
  console.log(`${quota.used}/${quota.max} sandboxes used.`)
}

program
  .command('list')
  .alias('ls')
  .description('Lists sandboxes that you have managed locally.')
  .option('-r, --remote', 'Show sandboxes from the server.')
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

  cliUtils.logWithBorder("Detailed information for the sandbox:");

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
  .description('Provides details about a sandbox.')
  .action(async function (arg, cmd) {
    try {
      var sandboxIdToUse = null;
      if (!arg) {
        if (sandboxClientManager.hasCurrent()) {
          sandboxIdToUse = sandboxClientManager.getCurrentSandboxId();
        } else {
          cliUtils.logAndExit(1, 'ERROR: Unable to determine sandbox_id.');
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
  .description('Shows rule tree for sandbox.')
  .action(async function (arg, cmd) {
    try {
      var sandboxIdToUse = null;
      if (!arg) {
        if (sandboxClientManager.hasCurrent()) {
          sandboxIdToUse = sandboxClientManager.getCurrentSandboxId();
        } else {
          cliUtils.logAndExit(1, 'ERROR: Unable to determine sandbox_id.');
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
      cliUtils.logAndExit(1,`CERROR: ould not find any local sandboxes matching input: ${identifier}`)
    } else {
      return null;
    }
  } else if (results.length > 1) {
    cliUtils.logAndExit(1, `ERROR: ${results.length} Local sandboxes match input. Please be more specific.`);
  } else {
    return results[0];
  }
}

function orCurrent(sandboxIdentifier) {
  if (sandboxIdentifier) {
    return sandboxIdentifier;
  }
  if (!sandboxClientManager.hasCurrent()) {
    return 'No current `sandboxId`. Specify a `sandboxId`.';
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
  .description('Sets the identified sandbox as currently active.')
  .action(function (arg, options) {
    var sb = getLocalSandboxForIdentifier(arg);
    sandboxClientManager.makeCurrent(sb.sandboxId);
    console.log(`Sandbox: ${sb.name} is now active`)
  });

program
  .command('delete <sandbox-id>')
  .description('Deletes the sandbox.')
  .action(async function (sandboxId, options) {
    try {
      if (!await cliUtils.confirm('Are you sure you want to delete this sandbox?')) {
        return;
      }

      var progressMsg = `Deleting sandboxId: ${sandboxId}`;
      await cliUtils.spinner(sandboxSvc.deleteSandbox(sandboxId), progressMsg);

      sandboxClientManager.flushLocalSandbox(sandboxId);
    } catch (e) {
      console.error(e);
    }
  });

function parseToBoolean(str: string) {
  if (!str) {
    return false;
  }
  const parsedInput = str.trim().toLowerCase();
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
  if (!strToBool.has(parsedInput)) {
    cliUtils.logAndExit(1, `ERROR: Unable to determine boolean value from input: ${str}. Enter y/n.`)
  } else {
    return strToBool.get(parsedInput);
  }
}

program
  .command('update-property <sandbox-id> <sandbox-property-id>')
  .description('Updates a sandbox-property.')
  .option('-r, --rules <file>', 'JSON file containing a PAPI rule tree.')
  .option('-H, --requesthostnames <string>', 'Comma-delimited list of request hostnames within the sandbox.')
  .action(async function (sandboxId, sandboxPropertyId, options) {
    var rules = options.rules;
    var requestHostnames = options.requesthostnames;
    try {
      await updateHostnamesAndRules(requestHostnames, rules, sandboxId, sandboxPropertyId);
      console.log(`Successfully updated sandbox_id: ${sandboxId} sandbox_property_id: ${sandboxPropertyId}`);
    } catch (e) {
      console.log(e);
    }
  });

async function updateHostnamesAndRules(requestHostnames, rulesFilePath, sandboxId, sandboxPropertyId) {
  if (requestHostnames) {
    const property = await cliUtils.spinner(sandboxSvc.getProperty(sandboxId, sandboxPropertyId), `Loading sandboxPropertyId: ${sandboxPropertyId}`);
    property.requestHostnames = parseHostnameCsv(requestHostnames);
    await cliUtils.spinner(sandboxSvc.updateProperty(sandboxId, property), `Updating sandboxPropertyId: ${sandboxPropertyId}`);
  }
  if (rulesFilePath) {
    const rules = getJsonFromFile(rulesFilePath);
    await cliUtils.spinner(sandboxSvc.updateRules(sandboxId, sandboxPropertyId, rules), 'Updating rules.');
  }
}

program
  .command('update [sandbox-identifier]')
  .description('Updates a sandbox.')
  .option('-r, --rules <file>', 'JSON file containing a PAPI rule tree.')
  .option('-c, --clonable <boolean>', 'Make this sandbox clonable? (Y/N)')
  .option('-n, --name <string>', 'Name of sandbox.')
  .option('-H, --requesthostnames <string>', 'Comma-delimited list of request hostnames within the sandbox.')
  .option('--recipe <path>', 'Path to `recipe.json` file.')
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
      if (isNonEmptyString(options.name)) {
        sandbox.name = options.name;
      }

      await cliUtils.spinner(sandboxSvc.updateSandbox(sandbox), `updating sandbox_id: ${sandbox.sandboxId}`);

      const propertyChange: boolean = !!options.requesthostnames || !!options.rules;
      if (propertyChange && sandbox.properties.length > 1) {
        cliUtils.logAndExit(1, `ERROR: Unable to update property as multiple were found (${sandbox.properties.length}). Use update-property to add additional properties to the sandbox.`);
      }
      const sandboxPropertyId = sandbox.properties[0].sandboxPropertyId;
      await updateHostnamesAndRules(options.requesthostnames, options.rules, sandboxId, sandboxPropertyId);
      console.log(`Successfully updated sandbox_id: ${sandboxId}`)
    } catch (e) {
      console.log(e);
    }
  });

function getJsonFromFile(papiFilePath) {
  try {
    return JSON.parse(readFileAsString(papiFilePath));
  } catch (ex) {
    console.error('JSON file is invalid.' + ex);
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
  .description('Creates a replica of a given sandbox.')
  .option('-n, --name <string>', 'Name of sandbox.')
  .action(async function (arg, options) {
    try {
      const sandboxId = getSandboxIdFromIdentifier(arg);
      if (!isNonEmptyString(options.name)) {
        cliUtils.logAndExit(1, 'ERROR: Parameter --name is required.');
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
    cliUtils.logAndExit(1, `ERROR: File: ${papiFilePath} does not exist.`);
  }
  const papiJson = getJsonFromFile(papiFilePath);
  return await cliUtils.spinner(sandboxSvc.addPropertyFromRules(sandboxId, hostnames, papiJson), `adding sandbox property to ${sandboxId}`);
}

async function createFromRules(papiFilePath: string, propForRules: string, hostnames: Array<string>, isClonable: boolean, name: string, cpcode: number) {
  if (!fs.existsSync(papiFilePath)) {
    cliUtils.logAndExit(1, `ERROR: File: ${papiFilePath} does not exist.`);
  }
  const papiJson = getJsonFromFile(papiFilePath);
  const propertySpecObjMsg = `${JSON.stringify(propForRules)}`;
  return await cliUtils.spinner(sandboxSvc.createFromRules(papiJson, propForRules, hostnames, name, isClonable, cpcode), "creating new sandbox");
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
    cliUtils.logAndExit(1, `ERROR: Property_version: ${propertyVersion} must be an integer > 0.`);
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

function parseHostnameSpecifier(hostnameSpecifier) {
  return { hostname : hostnameSpecifier};
}

async function addPropertyToSandboxFromProperty(sandboxId: string, hostnames: Array<string>, propertySpecifier: string) {
  const propertySpecObj = parsePropertySpecifier(propertySpecifier);
  const msg = `Adding property from: ${JSON.stringify(propertySpecObj)}`;
  return await cliUtils.spinner(sandboxSvc.addPropertyFromProperty(sandboxId, hostnames, propertySpecObj), msg);
}

async function addPropertyToSandboxFromHostname(sandboxId: string, hostnames: Array<string>, hostname: string) {
  const msg = `Adding property based on: ${hostname}`;
  return await cliUtils.spinner(sandboxSvc.addPropertyFromProperty(sandboxId, hostnames, {hostname}), msg);
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

async function createFromPropertiesRecipe(recipe, cpcode) {
  const sandboxRecipe = recipe.sandbox;
  const properties = sandboxRecipe.properties;

  const firstProp = properties[0];
  let propForRules;
  if (firstProp.rulesPath) {
    console.log(`Found rules in properties. Locating property to include in the sandbox.`);

    if (firstProp.property) {
      propForRules = parsePropertySpecifier(firstProp.property);
    }
    else if (firstProp.hostname){
      propForRules = firstProp.hostname;
    }
  }

  console.log(`Creating sandbox and property 1 from recipe.`);
  const r = await cliUtils.spinner(createRecipeSandboxAndProperty(firstProp, propForRules, sandboxRecipe, cpcode));

  for (var i = 1; i < properties.length; i++) {
    try {
      console.log(`Creating property ${i + 1} from recipe.`);
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
    cliUtils.logAndExit(1, 'ERROR: Missing sandbox.cloneFrom.');
  }
  const sandboxId = cloneFrom.sandboxId;
  if (!sandboxId) {
    cliUtils.logAndExit(1, 'ERROR: Missing cloneFrom.sandboxId.');
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
    cliUtils.logAndExit(1, `ERROR: File ${recipeFilePath} does not exist.`);
  }
  const recipe = getJsonFromFile(recipeFilePath);
  var r = validateSchema(recipe);
  if (r.errors.length > 0) {
    cliUtils.logAndExit(1, `ERROR: There are issues with your recipe file\n ${r}`);
  }
  const sandboxRecipe = recipe.sandbox;
  sandboxRecipe.clonable = clonable || sandboxRecipe.clonable;
  sandboxRecipe.name = name || sandboxRecipe.name;
  var idx = 0;

  if (sandboxRecipe.properties) {
    sandboxRecipe.properties.forEach(p => {
      if (p.rulesPath) {
        if(!oneOf(p.property, p.hostname)) {
          cliUtils.logAndExit(1, `ERROR: Error with property ${idx} In order to use the rulesPath, you need to specify a property or hostname to base the sandbox on.`);
        }
        p.rulesPath = resolveRulesPath(recipeFilePath, p.rulesPath);
      }
      idx++;
    });

    idx = 0;
    sandboxRecipe.properties.forEach(p => {
      if (!oneOf(p.property, p.hostname)) {
        cliUtils.logAndExit(1, `ERROR: Error with property ${idx} Specify only one argument, choose either property or hostname.`);
      }
      if (p.rulesPath && !fs.existsSync(p.rulesPath)) {
        cliUtils.logAndExit(1, `ERROR: Error with property ${idx} could not load file at path: ${p.rulesPath}`);
      }

      // requestHostnames is no longer required when specifying rules, the hostnames can be obtained from the createFromProperty specified
      // However, providing requestHostnames will override those hostnames.

      /* if (p.rulesPath && (!p.requestHostnames || p.requestHostnames.length === 0)) {
          logAndExit(1, `ERROR: Error with property ${idx}. Must specify requestHostnames array when using rulesPath`);
      }*/
      idx++;
    });
  }
  return recipe;
}

async function updateFromRecipe(sandboxId, recipeFilePath, name, clonable) {
  const recipe = validateAndBuildRecipe(recipeFilePath, name, clonable);
  const sandboxRecipe = recipe.sandbox;

  if (recipe.sandbox.cloneFrom) {
    cliUtils.logAndExit(1, 'ERROR: You cannot use the update command with cloneFrom recipe.');
  }

  if (!sandboxRecipe.properties) {
    cliUtils.logAndExit(1, 'ERROR: Missing properties, unable to perform operation.');
  }
  console.log(`Loading information for sandbox_id: ${sandboxId}`);
  const sandbox: any = await cliUtils.spinner(sandboxSvc.getSandbox(sandboxId));
  sandbox.isClonable = recipe.clonable;
  sandbox.name = recipe.name;

  console.log(`Updating sandbox information for sandbox_id: ${sandboxId}`);
  await sandboxSvc.updateSandbox(sandbox);

  var pIds = sandbox.properties.map(p => p.sandboxPropertyId);
  const first = pIds[0];
  for (var i = 1; i < pIds.length; i++) {
    const propertyId = pIds[i];
    console.log(`Deleting sandbox_property_id: ${propertyId}`);
    await cliUtils.spinner(sandboxSvc.deleteProperty(sandboxId, propertyId));
  }

  const propertyObj = {
    sandboxPropertyId: first,
    requestHostnames: [uuidv1()]
  };

  console.log(`Updating sandbox_property_id: ${first}`);
  await cliUtils.spinner(sandboxSvc.updateProperty(sandboxId, propertyObj));

  for (var i = 0; i < sandboxRecipe.properties.length; i++) {
    const rp = sandboxRecipe.properties[i];
    console.log(`Re-building property: ${i + 1}`);
    await cliUtils.spinner(createRecipeProperty(rp, sandboxId));
  }

  console.log(`Deleting sandbox_property_id: ${first}`);
  await cliUtils.spinner(sandboxSvc.deleteProperty(sandboxId, first));
}


async function createFromRecipe(recipeFilePath, name, clonable, cpcode) {
  const recipe = validateAndBuildRecipe(recipeFilePath, name, clonable);

  const sandboxRecipe = recipe.sandbox;

  var res = null;
  if (sandboxRecipe.properties) {
    res = await createFromPropertiesRecipe(recipe, cpcode);
  } else if (sandboxRecipe.cloneFrom) {
    res = await createFromCloneRecipe(recipe);
  } else {
    cliUtils.logAndExit(1, "ERROR: could not find either sandbox.properties or sandbox.cloneFrom.");
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
    cliUtils.logAndExit(1, "ERROR: Critical error with recipe property. Define the rulesPath or property.");
  }
}

function createRecipeSandboxAndProperty(rp, propertyForRules, recipe, cpcode) {
  if (rp.property) {
    return createFromProperty(rp.property, rp.requestHostnames, recipe.clonable, recipe.name, cpcode);
  } else if (rp.hostname) {
    return createFromHostname(rp.hostname, rp.requestHostnames, recipe.clonable, recipe.name, cpcode);
  } else if (rp.rulesPath) {
    return createFromRules(rp.rulesPath, propertyForRules, rp.requestHostnames, recipe.clonable, recipe.name, cpcode);
  } else {
    cliUtils.logAndExit(1, "ERROR: Critical error with recipe property. Define the rulesPath or property.");
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

function isNonEmptyString(obj) {
  return obj !== null
    && obj !== undefined
    && (typeof obj === 'string')
    && obj.trim().length > 0;
}

program
  .command('create')
  .description('Creates a new sandbox')
  .option('-r, --rules <file>', 'JSON file containing a PAPI rule tree. You need to specify a property or hostname to base the sandbox on when using this method.')
  .option('-p, --property <property_id | property_name : version>', 'Property to base the sandbox on. If an active version is not found, the most recent version is used.')
  .option('-o, --hostname <hostname>', 'The hostname of your Akamai property, such as www.example.com.')
  .option('-c, --clonable <boolean>', 'Make this sandbox clonable.')
  .option('-n, --name <string>', 'Name of sandbox.')
  .option('-H, --requesthostnames <string>', 'Comma separated list of request hostnames.')
  .option('--recipe <path>', 'Path to recipe.json file.')
  .option('-C, --cpcode <cpcode>', 'Specify an existing cpcode instead of letting the system generate a new one.')
  .action(async function (options) {
    helpExitOnNoArgs(options);
    const cpcode = options.cpcode;
    try {
      const recipePath = options.recipe;
      if (recipePath) {
        await createFromRecipe(recipePath, options.name, options.clonable, cpcode);
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
        cliUtils.logAndExit(1, `ERROR: You must provide a name for your sandbox.`);
      }

      // if --rules is specified, then either --property or --hostname must be specified
      if (papiFilePath) {
        if(!oneOf(propertySpecifier, hostnameSpecifier)) {
          cliUtils.logAndExit(1, `ERROR: Either --property or --hostname must be specified to base the created sandbox on when --rules is specified.`);
        }
        if(propertySpecifier) {
          propForRules = parsePropertySpecifier(propertySpecifier);
        }
        else {
          propForRules = parseHostnameSpecifier(hostnameSpecifier);
        }
      }

      // if hostnames are accepted with --rules then leave this below logic as it is
      // else add logic when --rules and --hostname is detected as invalid
      if (!oneOf(propertySpecifier, hostnameSpecifier)) {
        cliUtils.logAndExit(1, `ERROR: Exactly one of the following must be specified : --property, --hostname. Choose one of those arguments.`)
      }


      // requestHostnames is no longer required when specifying --rules, the hostnames can be obtained from the createFromProperty specified
      // However, providing requestHostnames will override those hostnames.

      /* if (!hostnamesCsv && papiFilePath) {
        logAndExit(1, 'ERROR: --requesthostnames must be specified when specifying --rules');
      }*/

      const hostnames = hostnamesCsv ? parseHostnameCsv(hostnamesCsv) : undefined;

      var r = null;
      if (papiFilePath) {
        r = await createFromRules(papiFilePath, propForRules, hostnames, isClonable, name, cpcode);
      } else if (propertySpecifier) {
        r = await createFromProperty(propertySpecifier, hostnames, isClonable, name, cpcode);
      } else if (hostnameSpecifier) {
        r = await createFromHostname(hostnameSpecifier, hostnames, isClonable, name, cpcode);
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
  let hasVariableForOrigin = false;
  if (origins.length > 0) {
    console.log(`Detected the following origins: ${origins.join(', ')}`);
    const regexPMUserVariable = new RegExp("(\{\{(.)+\}\})");
    hasVariableForOrigin = origins.some(origin => regexPMUserVariable.test(origin));
    if (await cliUtils.confirm('Do you want the Sandbox Client to proxy the origins in your dev environment to the destination defined in the Akamai config? Enter **y** and the CLI will automatically update your configuration file. If you want to route sandbox traffic to different development origins, enter **n** to customize the origin mappings.')) {
      passThrough = true;
    }
  }

  console.log('registering sandbox in local datastore');
  var registration = sandboxClientManager.registerNewSandbox(sandboxId, jwt, name, origins, clientConfig, passThrough);

  console.info(`Successfully created sandbox_id ${sandboxId} Generated sandbox client configuration at ${registration.configPath} Edit this file to specify the port and host for your dev environment.`);
  if(hasVariableForOrigin) {
    console.error(`\nAt least one property of this sandbox has a user defined variable for origin hostname.`)
    console.error(`Edit the sandbox client configuration file ${registration.configPath} and replace the variable with a static hostname.`);
  }
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
  .description('Starts the sandbox client.')
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

function addPropertyToSandbox(sandboxId, property, rulesPath, hostname, requestHostnames){
  if (property) {
    return addPropertyToSandboxFromProperty(sandboxId, requestHostnames, property);
  } else if (rulesPath) {
    return addPropertyFromRules(sandboxId, rulesPath, requestHostnames);
  } else if (hostname) {
    return addPropertyToSandboxFromHostname(sandboxId, requestHostnames, hostname);
  } else {
    cliUtils.logAndExit(1, `ERROR: Critical error while adding property to the sandbox : ${sandboxId} You need to define the rulesPath or property.`);
  }
}

// add-property to sandbox command definitions
program
  .command('add-property [sandbox-identifier]')
  .description('Add a property to a sandbox')
  .option('-r, --rules <file>', 'JSON file containing a PAPI rule tree.')
  .option('-p, --property <property_id | property_name : version>', 'Property to use. If you do not specify a version, the most recent version is used.')
  .option('-o, --hostname <hostname>', 'The hostname of your Akamai property, such as www.example.com.')
  .option('-H, --requesthostnames <string>', 'Comma separated list of request hostnames.')
  .action(async function(arg, options) {
    helpExitOnNoArgs(options);
    try {
      const papiFilePath = options.rules;
      const propertySpecifier= options.property;
      const hostnameSpecifier = options.hostname;
      const hostnamesCsv = options.requesthostnames;

      let sandboxId = null;
      if (!arg) {
        sandboxId = sandboxClientManager.getCurrentSandboxId();
        if (!sandboxId) {
          cliUtils.logAndExit(1, 'ERROR: Unable to determine sandbox_id.');
        }
      } else {
        sandboxId = getSandboxIdFromIdentifier(arg);
      }

      if (!oneOf(propertySpecifier, papiFilePath, hostnameSpecifier)) {
        cliUtils.logAndExit(1, `ERROR: You need to specify exactly one of these arguments: --property, --rules, --hostname. Choose one.`)
      }

      if (!hostnamesCsv && papiFilePath) {
        cliUtils.logAndExit(1, 'ERROR: If you use the --rules method, you need to specify --requesthostnames for the sandbox.');
      }
      const hostnames = hostnamesCsv ? parseHostnameCsv(hostnamesCsv) : undefined;

      addPropertyToSandbox(sandboxId, propertySpecifier, papiFilePath, hostnameSpecifier, hostnames);
    }
    catch (e) {
      console.error(e);
    }
  });

// sync sandbox from remote using jwt
program
  .command('sync-sandbox <jwtToken>')
  .description('Sync down a remote sandbox to the local system')
  .option('-n, --name <string>', 'Recommended to use the sandbox name provided during creation. If sandbox folder name already exists locally, custom sandbox name can be provided.')
  .action(async function(jwt, options) {
    helpExitOnNoArgs(options);
    sandboxSvc.setAccountWide(true);
      try {
        let sandboxName;
        const decodedJwt :object= jwtDecode(jwt);
        const sandboxId = decodedJwt[`sandboxID`];
        let localMatchedSandboxName = null;
        let matchedLocalSandbox = sandboxClientManager.getAllSandboxes().some(sandbox => {
          if(sandbox.sandboxId == sandboxId) {
            localMatchedSandboxName = sandbox.name;
            return true;
          }
        });
        if(matchedLocalSandbox) {
          cliUtils.logAndExit(0, `\nAborting Sync...\nThe sandbox with sandbox id : ${sandboxId} and sandbox name ${localMatchedSandboxName} is already synced locally. Further syncs are not required for further updates to this sandbox.`);
        }
        console.log(`Syncing sandbox with sandboxId : ${sandboxId}`);
        if(isNonEmptyString(options.name)) {
          sandboxName = options.name
        }
        else {
          let sandbox = await sandboxSvc.getSandbox(sandboxId);
          sandboxName = sandbox['name'];
          console.log(`Fetched Sandbox Name : ${sandboxName} from the provided jwtToken`);
        }

        const hasSandboxName = await sandboxClientManager.hasSandboxFolder(sandboxName);
        if(!hasSandboxName) {
          await registerSandbox(sandboxId, jwt, sandboxName);
        }
        else {
          console.error(`Error: Sandbox folder name ${sandboxName} already exists locally. Please provide a different sandbox name for this local sandbox folder using option -n or --name.`)
        }
      }
      catch(e) {
        let errorMessage = e.message != null ? e.message : e;
        console.error(`Error syncing sandbox : ${errorMessage}`);
      }
    sandboxSvc.setAccountWide(false);

  });


async function pushEdgeWorkerToSandbox(sandboxId, edgeworkerId, edgeworkerTarballPath, action) {
  action = (action == 'add') ? 'adding' : 'updating';
  const msg = `${action} edgeworker ${edgeworkerId} for: ${sandboxId} from ${edgeworkerTarballPath}`;
  return await cliUtils.spinner(sandboxSvc.pushEdgeWorkerToSandbox(sandboxId, edgeworkerId, edgeworkerTarballPath), msg);
}

program
  .command('add-edgeworker <edgeworker-id> <edgeworker-tarball>')
  .description('Add edgeworker to the currently active sandbox. The edgeworker-id must be an unsigned integer.')
  .action(async function(edgeworkerId, edgeworkerTarballPath, options) {
    helpExitOnNoArgs(options);
    addOrUpdateEdgeWorker(edgeworkerId, edgeworkerTarballPath, 'add');
  });

program
  .command('update-edgeworker <edgeworker-id> <edgeworker-tarball>')
  .description('Update edgeworker to the currently active sandbox')
  .action(async function(edgeworkerId, edgeworkerTarballPath, options) {
    helpExitOnNoArgs(options);
    addOrUpdateEdgeWorker(edgeworkerId, edgeworkerTarballPath, 'update');
  });

async function addOrUpdateEdgeWorker(edgeworkerId, edgeworkerTarballPath, action) {
  try {

    let sandboxId = sandboxClientManager.getCurrentSandboxId();
    if (!sandboxId) {
      cliUtils.logAndExit(1, 'ERROR: Unable to determine sandbox_id');
    }

    if(!fs.existsSync(edgeworkerTarballPath)) {
      cliUtils.logAndExit(1, `ERROR: Provided edgeworker tarball path ${edgeworkerTarballPath} not found.`);
    }
    let buffer = fs.readFileSync(edgeworkerTarballPath);
    let hex = buffer.toString('hex');
    await pushEdgeWorkerToSandbox(sandboxId, edgeworkerId, edgeworkerTarballPath, action);
    console.log('done!');

  }
  catch (e) {
    console.error(e);
  }
}

async function pullEdgeWorkerFromSandbox(sandboxId, edgeworkerId) {
  const msg = `downloading edgeworker ${edgeworkerId} for: ${sandboxId}`;
  return await cliUtils.spinner(sandboxSvc.pullEdgeWorkerFromSandbox(sandboxId, edgeworkerId), msg);
}

async function makeFileForEdgeworker(edgeworkerId, hexFile) {

  let edgeworkerFolder = path.join(process.env.AKAMAI_CLI_CACHE_PATH,
    `sandbox-cli/sandboxes`,
    sandboxClientManager.getCurrentSandboxName(),
    'edgeworkers/');
  if(!fs.existsSync(edgeworkerFolder)) {
    fs.mkdirSync(edgeworkerFolder);
  }
  let filename = `${edgeworkerId}_${new Date().getTime()}.tgz`;
  fs.writeFileSync(`${edgeworkerFolder}/${filename}`, Buffer.from(hexFile, "hex"));
  console.log(`Downloaded edgeworker file :${filename} for edgeworker id : ${edgeworkerId} at location : ${edgeworkerFolder}`);
}

program
  .command('download-edgeworker <edgeworker-id>')
  .description('Download edgeworker for the currently active sandbox')
  .action(async function(edgeworkerId, options) {
    helpExitOnNoArgs(options);
    try {


      let sandboxId = sandboxClientManager.getCurrentSandboxId();
      if (!sandboxId) {
        cliUtils.logAndExit(1, 'ERROR: Unable to determine sandbox_id');
      }
      let hexFile = await pullEdgeWorkerFromSandbox(sandboxId, edgeworkerId);

      makeFileForEdgeworker(edgeworkerId, hexFile);

    }
    catch (e) {
      console.error(e);
    }
  });


async function deleteEdgeWorkerFromSandbox(sandboxId, edgeworkerId) {
  const msg = `deleting edgeworker ${edgeworkerId} for: ${sandboxId}`;
  return await cliUtils.spinner(sandboxSvc.deleteEdgeWorkerFromSandbox(sandboxId, edgeworkerId), msg);
}

program
  .command('delete-edgeworker <edgeworker-id>')
  .description('Delete edgeworker for the currently active sandbox')
  .action(async function(edgeworkerId, options) {
    helpExitOnNoArgs(options);
    try {

      let sandboxId = sandboxClientManager.getCurrentSandboxId();
      if (!await cliUtils.confirm(
        `Are you sure you want to delete the edgeworker with id: ${edgeworkerId} for the currently active sandbox : ${sandboxId} `)) {
        return;
      }
      if (!sandboxId) {
        cliUtils.logAndExit(1, 'ERROR: Unable to determine sandbox_id');
      }
      await deleteEdgeWorkerFromSandbox(sandboxId, edgeworkerId);
      console.log('done!');

    }
    catch (e) {
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
