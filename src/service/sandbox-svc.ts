import * as envUtils from '../utils/env-utils.js';
import * as cliUtils from '../utils/cli-utils.js';
import * as fs from 'fs';

import { URLSearchParams } from "url";

let accountKey: string = null;
let accountWide: boolean = false;

const SANDBOX_API_BASE = '/sandbox-api/v1';

export function setAccountKey(account: string) {
  accountKey = account;
}

export function setAccountWide(value: boolean) {
  accountWide = value;
}

function sendEdgeRequest(pth: string, method: string, body, headers, filePath?: string, searchParams?: URLSearchParams) {
  const edge = envUtils.getEdgeGrid();
  let path = pth;

  if (accountKey) {
    if (searchParams == null) {
      searchParams = new URLSearchParams();
    }
    searchParams.append('accountSwitchKey', accountKey);
  }

  if (searchParams) {
    path += `?${searchParams.toString()}`;
  }
  headers = {
    ...headers,
    'User-Agent': 'sandbox-cli'
  }

  return new Promise<any>(
    (resolve, reject) => {
      if (filePath) {
        edge.auth({
          path,
          method,
          headers,
          body: fs.readFileSync(filePath),
        })
      } else {
        edge.auth({
          path,
          method,
          headers,
          body
        })
      }

      edge.send(function(error, response, body) {
        if (error) {
          if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            const errorObj = {
              path,
              method,
            }
            Object.assign(errorObj, error.response.data);
            reject(cliUtils.toJsonPretty(errorObj))
          } else {
            // Something happened in setting up the request that triggered an Error
            cliUtils.logError(`got error code: ${error.status} calling ${method} ${path}\n${error.message}`);
            reject(error);
          }
        } else {
          // The request was successful
          resolve({
            response,
            body: !!body ? parseIfJSON(body) : undefined
          });
        }
      });
    });
}

function parseIfJSON(value) {
  try {
    return JSON.parse(value);
  } catch (e) {
    return value;
  }
}

function postJson(path: string, body) {
  return sendEdgeRequest(path, 'POST', body, {
    'Content-Type': 'application/json'
  });
}

function putJson(path: string, body) {
  return sendEdgeRequest(path, 'PUT', body, {
    'Content-Type': 'application/json'
  });
}

function putTarball(path: string, edgeworkerTarballPath) {
  return sendEdgeRequest(path, 'PUT', '', {
    'Content-Type': 'application/tar+gzip'
  }, edgeworkerTarballPath);
}

function getJson(path: string) {
  const searchParams = accountWide ? new URLSearchParams('access=account') : null;

  return sendEdgeRequest(path, 'GET', '', {}, null, searchParams);
}

function getTarball(path: string) {
  return sendEdgeRequest(path, 'GET', '', {
    'Accept': 'application/vnd.akamai-sandbox.hex+text'
  });
}

function del(path: string) {
  return sendEdgeRequest(path, 'DELETE', '', {});
}

export function deleteSandbox(sandboxId: string) {
  return sendEdgeRequest(`${SANDBOX_API_BASE}/sandboxes/${sandboxId}`, 'DELETE', '', {}).then(r => r.body);
}

export function cloneSandbox(sandboxId: string, name: string, clonable = false) {
  const body = {
    name,
    isClonable: clonable
  };
  return postJson(`${SANDBOX_API_BASE}/sandboxes/${sandboxId}/clone`, body).then(r => r.body);
}

export function getAllSandboxes() {
  return getJson(`${SANDBOX_API_BASE}/sandboxes`).then(r => {
    const limit = parseInt(r.response.headers['x-limit-sandboxes-limit']);
    const remaining = parseInt(r.response.headers['x-limit-sandboxes-remaining']);
    return {
      quota: {
        max: limit,
        used: limit - remaining
      },
      result: r.body
    }
  });
}

export function getSandbox(sandboxId: string) {
  return getJson(`${SANDBOX_API_BASE}/sandboxes/${sandboxId}`).then(r => r.body);
}

export function updateSandbox(sandbox) {
  return putJson(`${SANDBOX_API_BASE}/sandboxes/${sandbox.sandboxId}`, sandbox).then(r => r.body);
}

export function createFromRules(papiRules, fromPropertyObj, requestHostnames, name, isClonable, cpcode) {
  const bodyObj = {
    name: name,
    createFromRules: papiRules,
    createFromProperty: fromPropertyObj,
    isClonable: isClonable
  };

  if (requestHostnames) {
    bodyObj['requestHostnames'] = requestHostnames;
  }

  if (cpcode) {
    bodyObj['cpcode'] = cpcode;
  }

  return postJson(`${SANDBOX_API_BASE}/sandboxes`, bodyObj).then(r => r.body);
}

export function addPropertyFromRules(sandboxId: string, requestHostnames, cpCode: number, papiRules) {
  const bodyObj = {
    cpCode: cpCode,
    requestHostnames: requestHostnames,
    createFromRules: papiRules
  };
  return postJson(`${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties`, bodyObj).then(r => r.body);
}

export function addPropertyFromProperty(sandboxId: string, requestHostnames, cpCode: number, fromPropertyObj) {
  const bodyObj = {
    createFromProperty: fromPropertyObj,
  };
  if (requestHostnames) {
    bodyObj['requestHostnames'] = requestHostnames;
  }
  if (cpCode) {
    bodyObj['cpcode'] = cpCode;
  }
  return postJson(`${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties`, bodyObj).then(r => r.body);
}

export function createFromProperty(requestHostnames, name, isClonable, fromPropertyObj, cpcode) {
  const bodyObj = {
    name: name,
    createFromProperty: fromPropertyObj,
    isClonable: isClonable
  };
  if (requestHostnames) {
    bodyObj['requestHostnames'] = requestHostnames;
  }

  if (cpcode) {
    bodyObj['cpcode'] = cpcode;
  }
  return postJson(`${SANDBOX_API_BASE}/sandboxes`, bodyObj).then(r => r.body);
}

export function getRules(sandboxId: string, sandboxPropertyId: string) {
  const endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties/${sandboxPropertyId}/rules`;
  return getJson(endpoint).then(r => r.body);
}

export function updateRules(sandboxId: string, sandboxPropertyId: string, rules) {
  const endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties/${sandboxPropertyId}/rules`;
  const body = {
    rules: rules.rules ? rules.rules : rules
  };
  return putJson(endpoint, body).then(r => r.body);
}

export function getProperty(sandboxId: string, sandboxPropertyId: string) {
  const endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties/${sandboxPropertyId}`;
  return getJson(endpoint).then(r => r.body);
}

export function updateProperty(sandboxId, propertyObj) {
  const endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties/${propertyObj.sandboxPropertyId}`;
  return putJson(endpoint, propertyObj).then(r => r.body);
}

export function deleteProperty(sandboxId, sandboxPropertyId) {
  const endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties/${sandboxPropertyId}`;
  return del(endpoint).then(r => r.body);
}

export function pushEdgeWorkerToSandbox(sandboxId: string, edgeworkerId: string, edgeworkerTarballPath) {
  const endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/edgeworkers/${edgeworkerId}`;
  return putTarball(endpoint, edgeworkerTarballPath).then(r => r.body);
}

export function pullEdgeWorkerFromSandbox(sandboxId: string, edgeworkerId: string) {
  const endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/edgeworkers/${edgeworkerId}`;
  return getTarball(endpoint).then(r => r.body);
}

export function deleteEdgeWorkerFromSandbox(sandboxId: string, edgeworkerId: string) {
  const endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/edgeworkers/${edgeworkerId}`;
  return del(endpoint).then(r => r.body);
}

export function rotateJWT(sandboxId: string) {
  const endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/rotateJWT`;
  return postJson(endpoint, {}).then(r => r.body);
}



