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
  .option('-d, --debug', 'show debug information')
  .on("option:debug", function () {
    envUtils.setDebugMode(true);
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
  .command('ls')
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

async function showAllPapiRules(sandboxId: string) {
  var sandbox: any = await cliUtils.spinner(sandboxSvc.getSandbox(sandboxId));
  showAllPapiRulesHelper(sandboxId, sandbox);
}

async function showAllPapiRulesHelper(sandboxId: string, sandbox) {
  var pIds = sandbox.properties.map(p => p.sandboxPropertyId);
  var r = [];

  for (var pid of pIds) {
    var obj: any = await cliUtils.spinner(sandboxSvc.getRules(sandboxId, pid));
    r.push({
      title: `sandbox_property_id: ${pid}`,
      rules: obj.rules
    });
  }

  r.forEach(o => {
    cliUtils.logWithBorder(o.title);
    console.log(JSON.stringify(o.rules, undefined, 2));
  })
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

  cliUtils.logWithBorder("Sandbox Poperties");

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
      await showAllPapiRules(sandboxIdToUse);
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
  .option('-rules, --rules <file>', 'papi json file')
  .option('-h, --requestHostnames <string>', 'comma separated list of request hostnames')
  .action(async function (sandboxId, sandboxPropertyId, options) {
    var rules = options.rules;
    var requestHostnames = options.requestHostnames;
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
    const rules = getPapiRulesFromFile(rulesFilePath);
    await cliUtils.spinner(sandboxSvc.updateRules(sandboxId, sandboxPropertyId, rules), 'updating rules');
  }
}

program
  .command('update [sandbox-identifier]')
  .description('updates a sandbox')
  .option('-rules, --rules <file>', 'papi json file')
  .option('-c, --clonable <boolean>', 'make this sandbox clonable')
  .option('-n, --sandboxName <string>', 'name of sandbox')
  .option('-h, --requestHostnames <string>', 'comma separated list of request hostnames')
  .action(async function (arg, options) {
    helpExitOnNoArgs(options);
    try {

      const sandboxId = getSandboxIdFromIdentifier(orCurrent(arg));
      const sandbox = await cliUtils.spinner(sandboxSvc.getSandbox(sandboxId), `loading sandboxId: ${sandboxId}`);
      if (options.clonable) {
        sandbox.isClonable = parseToBoolean(options.clonable);
      }
      if (options.sandboxName) {
        sandbox.name = options.sandboxName;
      }

      await cliUtils.spinner(sandboxSvc.updateSandbox(sandbox), `updating sandbox_id: ${sandbox.sandboxId}`);

      const propertyChange: boolean = !!options.requestHostnames || !!options.rules;
      if (propertyChange && sandbox.properties.length > 1) {
        logAndExit(`Unable to update property as multiple were found (${sandbox.properties.length}). Please use update-property.`);
      }
      const sandboxPropertyId = sandbox.properties[0].sandboxPropertyId;
      await updateHostnamesAndRules(options.requestHostnames, options.rules, sandboxId, sandboxPropertyId);
      console.log(`successfully updated sandbox_id: ${sandboxId}`)
    } catch (e) {
      console.log(e);
    }
  });

function getPapiRulesFromFile(papiFilePath) {
  try {
    return JSON.parse(readFileAsString(papiFilePath));
  } catch (ex) {
    console.error('papi JSON file is invalid ' + ex);
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
  .option('-n, --sandboxName <string>', 'name of sandbox')
  .action(async function (arg, options) {
    try {
      const sandboxId = getSandboxIdFromIdentifier(arg);
      if (!options.sandboxName) {
        logAndExit('parameter --sandboxName is required');
      }
      const name = options.sandboxName;
      const cloneResponse = await cliUtils.spinner(sandboxSvc.cloneSandbox(sandboxId, name));
      var r = sandboxClientManager.registerNewSandbox(cloneResponse.sandboxId, cloneResponse.jwtToken, name);
      console.info(`Successfully created sandbox_id ${cloneResponse.sandboxId}. Generated sandbox client configuration at ${r.configPath} please edit this file`);
    } catch (e) {
      console.log(e);
    }
  });

async function createFromRules(papiFilePath: string, hostnames: Array<string>, isClonable: boolean, name: string) {
  if (!fs.existsSync(papiFilePath)) {
    logAndExit(`file: ${papiFilePath} does not exist`);
  }
  const papiJson = getPapiRulesFromFile(papiFilePath);
  return await cliUtils.spinner(sandboxSvc.createFromRules(papiJson, hostnames, name, isClonable), "creating new sandbox");
}

async function createFromProperty(propertySpecifier: string, hostnames: Array<string>, isClonable: boolean, name: string) {
  const propertySpecObj: any = {};
  var intValidationOptions = {};
  if (propertySpecifier.indexOf(':') > -1) {
    var parts = propertySpecifier.split(':').map(s => s.trim());
    if (parts.length != 2) {
      logAndExit(`property specifier: ${propertySpecifier} is invalid. Please use property_id:property_version (e.g. 124:5)`);
    }
    if (!validator.isInt(parts[0], intValidationOptions)) {
      logAndExit(`property_id: ${parts[0]} must be an integer > 0`);
    }
    if (!validator.isInt(parts[1], intValidationOptions)) {
      logAndExit(`version: ${parts[1]} must be an integer > 0`);
    }
    // validate
    propertySpecObj.propertyId = parseInt(parts[0]);
    propertySpecObj.propertyVersion = parseInt(parts[1]);
  } else {
    if (!validator.isInt(propertySpecifier, intValidationOptions)) {
      logAndExit(`property_id: ${propertySpecifier} must be an integer > 0`);
    }
    // validate
    propertySpecObj.propertyId = parseInt(propertySpecifier);
  }

  var msg = `creating new sandbox from property_id: ${propertySpecObj.propertyId} `;
  if (propertySpecObj.propertyVersion) {
    msg += `version: ${propertySpecObj.propertyVersion}`;
  }
  return await cliUtils.spinner(sandboxSvc.createFromProperty(hostnames, name, isClonable, propertySpecObj), msg);
}

program
  .command('create')
  .description('create a new sandbox')
  .option('-rules, --fromRules <file>', 'papi json file')
  .option('-p, --fromProperty <property_id:version>', 'property to use. if no version is specified the latest will be used.')
  .option('-c, --clonable <boolean>', 'make this sandbox clonable')
  .option('-n, --sandboxName <string>', 'name of sandbox')
  .option('-hostnames, --requestHostnames <string>', 'comma separated list of request hostnames')
  .action(async function (options) {
    helpExitOnNoArgs(options);
    try {
      const papiFilePath = options.fromRules;
      const name = options.sandboxName;
      const hostnamesCsv = options.requestHostnames;
      const isClonable = !!options.clonable ? parseToBoolean(options.clonable) : false;
      if (!hostnamesCsv) {
        logAndExit('--requestHostnames must be specified');
      }
      const hostnames = parseHostnameCsv(hostnamesCsv);
      const propertySpecifier = options.fromProperty;

      //validation
      if (!name) {
        logAndExit(`You must provide a name for your sandbox`);
      }
      if (propertySpecifier && papiFilePath) {
        logAndExit(`Both --fromProperty and --fromRules were specified. Pick only one of those arguments`)
      } else if (!propertySpecifier && !papiFilePath) {
        logAndExit(`Unable to build sandbox. Must specify either --fromProperty or --fromRules`);
      }

      var r = null;
      if (papiFilePath) {
        r = await createFromRules(papiFilePath, hostnames, isClonable, name);
      } else {
        r = await createFromProperty(propertySpecifier, hostnames, isClonable, name);
      }

      console.log('registering sandbox in local datastore');
      var registration = sandboxClientManager.registerNewSandbox(r.sandboxId, r.jwtToken, name);

      console.info(`Successfully created sandbox_id ${r.sandboxId}. Generated sandbox client configuration at ${registration.configPath} please edit this file`);
    } catch (e) {
      console.log(e);
    }
  });

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
      await downloadClientIfNecessary();
      await sandboxClientManager.executeSandboxClient();
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
