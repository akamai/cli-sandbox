#!/usr/bin/env node
import * as envUtils from './utils/env-utils';
import * as cliUtils from './utils/cli-utils';
import * as fs from 'fs';
import * as sandboxClientManager from './service/sandbox-client-manager';
import * as sandboxSvc from './service/sandbox-svc'
import * as path from "path";
import * as os from "os";

const util = require('util');
const validator = require('validator');
const pkginfo = require('../package.json');

const cTable = require('console.table');

function logAndExit(msg: string) {
  console.log(msg);
  process.exit();
}

if (envUtils.getNodeVersion() < 8) {
  logAndExit("The Akamai Sandbox CLI requires Node 8 or later.");
}

const edgeRcPath = path.resolve(os.homedir(), '.edgerc');
if (!fs.existsSync(edgeRcPath)) {
  logAndExit(`Couldn't find .edgerc for Akamai {OPEN} client. Please configure your .edgerc file at this path: ${edgeRcPath}`);
}

const CLI_CACHE_PATH = process.env.AKAMAI_CLI_CACHE_PATH;

if (!CLI_CACHE_PATH) {
  logAndExit("error AKAMAI_CLI_CACHE_PATH is not set");
}

if (!fs.existsSync(CLI_CACHE_PATH)) {
  logAndExit(`AKAMAI_CLI_CACHE_PATH is set to ${CLI_CACHE_PATH} but this directory does not exist`);
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
  .on("option:edgerc", function (edgeRcFilePath) {
    envUtils.setEdgeRcFilePath(edgeRcFilePath);
  })
  .on("option:section", function (section) {
    envUtils.setEdgeRcSection(section);
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
  console.table(sandboxes);
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
  console.table(sandboxes);
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
  .action(async function (arg, options) {
    helpExitOnNoArgs(options);
    try {

      const sandboxId = getSandboxIdFromIdentifier(orCurrent(arg));
      const sandbox = await cliUtils.spinner(sandboxSvc.getSandbox(sandboxId), `loading sandboxId: ${sandboxId}`);
      if (options.clonable) {
        sandbox.isClonable = parseToBoolean(options.clonable);
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

      console.log('building origin list');
      var origins: Array<string> = await getOriginListForSandboxId(cloneResponse.sandboxId);
      var r = sandboxClientManager.registerNewSandbox(cloneResponse.sandboxId, cloneResponse.jwtToken, name, origins);
      console.info(`Successfully created sandbox_id ${cloneResponse.sandboxId}. Generated sandbox client configuration at ${r.configPath} please edit this file`);
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
    key = 'hostname';
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

async function createFromProperty(propertySpecifier: string, hostnames: Array<string>, isClonable: boolean, name: string) {
  const propertySpecObj = parsePropertySpecifier(propertySpecifier);
  const msg = `Creating from: ${JSON.stringify(propertySpecObj)}`;
  return await cliUtils.spinner(sandboxSvc.createFromProperty(hostnames, name, isClonable, propertySpecObj), msg);
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

async function createFromRecipe(recipeFilePath) {
  if (!fs.existsSync(recipeFilePath)) {
    logAndExit(`File ${recipeFilePath} does not exist. `);
  }

  const recipe = getJsonFromFile(recipeFilePath);
  if (!recipe.sandbox) {
    logAndExit(`no sandbox element found`);
  }
  const sandboxRecipe = recipe.sandbox;

  //TODO enforce schema on recipe file
  const properties = sandboxRecipe.properties;
  if (!properties || properties.length == 0) {
    logAndExit('recipe file does not contain any properties');
  }
  if (!sandboxRecipe.clonable) {
    logAndExit('recipe requires field clonable');
  }
  properties.forEach(p => {
    if (p.rulesPath) {
      p.rulesPath = resolveRulesPath(recipeFilePath, p.rulesPath);
    }
  });

  var idx = 0;
  properties.forEach(p => {
    if (!p.rulesPath && !p.property) {
      logAndExit(`Error with property ${idx} couldn't locate rulesPath or property for sandbox property.`);
    }
    if (p.rulesPath && !fs.existsSync(p.rulesPath)) {
      logAndExit(`Error with property ${idx} could not load file at path: ${p.rulesPath}`);
    }
    idx++;
  });

  const firstProp = properties[0];
  const r = await cliUtils.spinner(createRecipeSandboxAndProperty(firstProp, sandboxRecipe), `creating sandbox & property 1 from recipe`);

  for (var i = 1; i < properties.length; i++) {
    await cliUtils.spinner(createRecipeProperty(properties[0], sandboxRecipe), `creating sandbox & property ${i + 1} from recipe`);
  }

  await registerSandbox(r.sandboxId, r.jwtToken, sandboxRecipe.name);
}

async function createRecipeProperty(rp, sandboxId) {
  if (rp.property) {
    await cliUtils.spinner(addPropertyToSandboxFromProperty(sandboxId, rp.requestHostnames, rp.property));
  } else if (rp.rulesPath) {
    await cliUtils.spinner(addPropertyFromRules(sandboxId, rp.rulesPath, rp.requestHostnames));
  } else {
    logAndExit("critical error with recipe property. rulesPath or property needs to be defined.");
  }
}

async function createRecipeSandboxAndProperty(rp, recipe) {
  if (rp.property) {
    await cliUtils.spinner(createFromProperty(rp.property, rp.requestHostnames, recipe.clonable, recipe.name));
  } else if (rp.rulesPath) {
    await cliUtils.spinner(createFromRules(rp.rulesPath, rp.requestHostnames, recipe.clonable, recipe.name));
  } else {
    logAndExit("critical error with recipe property. rulesPath or property needs to be defined.");
  }
}

program
  .command('create')
  .description('create a new sandbox')
  .option('-r, --rules <file>', 'papi json file')
  .option('-p, --property <property_id | hostname : version>', 'property to use. if no version is specified the latest will be used.')
  .option('-c, --clonable <boolean>', 'make this sandbox clonable')
  .option('-n, --name <string>', 'name of sandbox')
  .option('-H, --requesthostnames <string>', 'comma separated list of request hostnames')
  .option('--recipe <path>', 'path to recipe json file')
  .action(async function (options) {
    helpExitOnNoArgs(options);
    try {
      const recipePath = options.recipe;
      if (recipePath) {
        await createFromRecipe(recipePath);
        return;
      }

      const papiFilePath = options.rules;
      const name = options.name;
      const hostnamesCsv = options.requesthostnames;
      const isClonable = !!options.clonable ? parseToBoolean(options.clonable) : false;
      if (!hostnamesCsv) {
        logAndExit('--requesthostnames must be specified');
      }
      const hostnames = parseHostnameCsv(hostnamesCsv);
      const propertySpecifier = options.property;

      //validation
      if (!name) {
        logAndExit(`You must provide a name for your sandbox`);
      }
      if (propertySpecifier && papiFilePath) {
        logAndExit(`Both --property and --rules were specified. Pick only one of those arguments`)
      } else if (!propertySpecifier && !papiFilePath) {
        logAndExit(`Unable to build sandbox. Must specify either --property or --rules`);
      }

      var r = null;
      if (papiFilePath) {
        r = await createFromRules(papiFilePath, hostnames, isClonable, name);
      } else {
        r = await createFromProperty(propertySpecifier, hostnames, isClonable, name);
      }

      await registerSandbox(r.sandboxId, r.jwtToken, name);

    } catch (e) {
      console.log(e);
    }
  });

async function registerSandbox(sandboxId: string, jwt: string, name: string) {
  console.log('building origin list');
  var origins: Array<string> = await getOriginListForSandboxId(sandboxId);

  console.log('registering sandbox in local datastore');
  var registration = sandboxClientManager.registerNewSandbox(sandboxId, jwt, name, origins);

  console.info(`Successfully created sandbox_id ${sandboxId}. Generated sandbox client configuration at ${registration.configPath} please edit this file`);
}

async function downloadClientIfNecessary() {
  try {
    if (!sandboxClientManager.isAlreadyInstalled()) {
      console.log("no connector installed. Installing sandbox client...");
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
