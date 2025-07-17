import * as cliUtils from '../utils/cli-utils.js';

import fs from "fs";
import path from "path";

const DEFAULT_ORIGIN_TARGET = {
  secure: false,
  port: 80,
  host: '<target hostname>'
};

export class SandboxConfig {
  private clientConfig: any;

  private readonly sandboxesDirectory: string;
  private readonly configPath: string;

  constructor(sandboxesBaseDir: string, sandboxName: string) {
    this.sandboxesDirectory = path.join(sandboxesBaseDir, sandboxName);
    this.configPath = path.join(this.sandboxesDirectory, '/config.json');
  }

  useClientConfig(config: any) {
    this.clientConfig = config;
  }

  create(jwt: string, origins: Array<string>, passThrough: boolean) {
    fs.mkdirSync(this.sandboxesDirectory);

    let config: any;
    if (this.clientConfig) {
      config = this.mergeOrigins(this.clientConfig, origins, passThrough);
    } else {
      config = this.buildNewConfig(origins, passThrough);
    }
    config.jwt = jwt;

    this.flushToFile(config);

    return {
      configPath: this.configPath
    }
  }

  updateJwt(jwt: string) {
    let config = this.readConfig();
    config.jwt = jwt;

    this.flushToFile(config);
  }

  private flushToFile(config) {
    const generatedConfig = cliUtils.toJsonPretty(config);
    fs.writeFileSync(this.configPath, generatedConfig);
  }

  private readConfig(): any {
    if (!fs.existsSync(this.configPath)) {
      cliUtils.logAndExit(1, `Unable to read config: ${this.configPath}. File does not exist or is not readable.`);
    } else {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
    }
  }

  private buildNewConfig(origins: Array<string>, passThrough: boolean) {
    const config = cliUtils.readJsonFileRelativeToAppRoot("template/client-config.json")

    if (!origins || origins.length == 0) {
      config.originMappings.push({
        from: '<ORIGIN HOSTNAME>',
        to: DEFAULT_ORIGIN_TARGET
      });
    } else {
      origins.forEach(o => {
        config.originMappings.push({
          from: o,
          to: passThrough ? 'pass-through' : DEFAULT_ORIGIN_TARGET
        });
      });
    }
    return config;
  }

  private mergeOrigins(clientConfig: any, origins: Array<string>, passThrough: boolean) {
    if (origins == null || origins.length == 0) {
      return;
    }
    const originsInClientConfig = new Set();
    clientConfig.originMappings.forEach(om => originsInClientConfig.add(om.from.trim()));

    origins.forEach(o => {
      if (!originsInClientConfig.has(o)) {
        clientConfig.originMappings.push({
          from: o,
          to: passThrough ? 'pass-through' : DEFAULT_ORIGIN_TARGET
        });
      }
    })

    return clientConfig;
  }

}
