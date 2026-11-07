declare module "node:fs/promises" {
  export function readFile(path: string | URL, encoding: "utf8"): Promise<string>;
  export function readFile(path: string | URL): Promise<Uint8Array>;
  export function writeFile(path: string | URL, data: string, encoding?: "utf8"): Promise<void>;
  export function writeFile(path: string | URL, data: Uint8Array): Promise<void>;
  export function mkdir(path: string | URL, options: { recursive: true }): Promise<string | undefined>;
}

declare module "node:path" {
  export function dirname(path: string): string;
}

declare const process: {
  readonly argv: string[];
  exitCode?: number;
};
