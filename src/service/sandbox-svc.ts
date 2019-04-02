import * as envUtils from '../utils/env-utils';
import * as cliUtils from '../utils/cli-utils';

var accountKey: string = null;

const SANDBOX_API_BASE = '/sandbox-api/v1';

export function setAccountKey(account: string) {
  accountKey = account;
}

function isOkStatus(code) {
  return code >= 200 && code < 300;
}

function sendEdgeRequest(pth: string, method: string, body, headers) {
  const edge = envUtils.getEdgeGrid();
  var path = pth;
  if (accountKey) {
    path += `?accountSwitchKey=${accountKey}`;
  }
  return new Promise<any>(
    (resolve, reject) => {
      edge.auth({
        path,
        method,
        headers,
        body
      });

      edge.send(function (error, response, body) {
        if (error) {
          reject(error);
        } else if (isOkStatus(response.statusCode)) {
          var obj: any = {
            response,
            body: !!body ? JSON.parse(body) : undefined
          };
          resolve(obj);
        } else {
          try {
            var errorObj = JSON.parse(body);
            reject(cliUtils.toJsonPretty(errorObj));
          } catch (ex) {
            console.error(`got error code: ${response.statusCode} calling ${method} ${path}\n${body}`);
            reject(body);
          }
        }
      });
    });
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

function getJson(path: string) {
  return sendEdgeRequest(path, 'GET', '', {});
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
  var bodyObj = {
    name: name,
    createFromRules: papiRules,
    createFromProperty: fromPropertyObj,
    isClonable: isClonable
  };

  if (requestHostnames) {
    bodyObj['requestHostnames'] = requestHostnames;
  }

  if(cpcode) {
    bodyObj['cpcode'] = cpcode;
  }

  return postJson(`${SANDBOX_API_BASE}/sandboxes`, bodyObj).then(r => r.body);
}

export function addPropertyFromRules(sandboxId: string, requestHostnames, papiRules) {
  var bodyObj = {
    requestHostnames: requestHostnames,
    createFromRules: papiRules
  };
  return postJson(`${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties`, bodyObj).then(r => r.body);
}

export function addPropertyFromProperty(sandboxId: string, requestHostnames, fromPropertyObj) {
  var bodyObj = {
    createFromProperty: fromPropertyObj,
  };
  if (requestHostnames) {
    bodyObj['requestHostnames'] = requestHostnames;
  }
  return postJson(`${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties`, bodyObj).then(r => r.body);
}

export function createFromProperty(requestHostnames, name, isClonable, fromPropertyObj, cpcode) {
  var bodyObj = {
    name: name,
    createFromProperty: fromPropertyObj,
    isClonable: isClonable
  };
  if (requestHostnames) {
    bodyObj['requestHostnames'] = requestHostnames;
  }

  if(cpcode) {
    bodyObj['cpcode'] = cpcode;
  }
  return postJson(`${SANDBOX_API_BASE}/sandboxes`, bodyObj).then(r => r.body);
}

export function getRules(sandboxId: string, sandboxPropertyId: string) {
  var endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties/${sandboxPropertyId}/rules`;
  return getJson(endpoint).then(r => r.body);
}

export function updateRules(sandboxId: string, sandboxPropertyId: string, rules) {
  var endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties/${sandboxPropertyId}/rules`;
  var body = {
    rules: rules.rules ? rules.rules : rules
  };
  return putJson(endpoint, body).then(r => r.body);
}

export function getProperty(sandboxId: string, sandboxPropertyId: string) {
  var endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties/${sandboxPropertyId}`;
  return getJson(endpoint).then(r => r.body);
}

export function updateProperty(sandboxId, propertyObj) {
  var endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties/${propertyObj.sandboxPropertyId}`;
  return putJson(endpoint, propertyObj).then(r => r.body);
}

export function deleteProperty(sandboxId, sandboxPropertyId) {
  const endpoint = `${SANDBOX_API_BASE}/sandboxes/${sandboxId}/properties/${sandboxPropertyId}`;
  return del(endpoint).then(r => r.body);
}
