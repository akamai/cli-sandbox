export class SandboxRecord {
  sandboxId: string;
  folder: string;
  current: boolean;
  name: string;
  jwt: string;

  constructor(sandboxId, folder, current, name, jwt) {
    this.sandboxId = sandboxId;
    this.folder = folder;
    this.current = current;
    this.name = name;
    this.jwt = jwt;
  }
}
