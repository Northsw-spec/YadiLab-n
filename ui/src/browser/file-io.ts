import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import type { BlobDownloadDescriptor, BrowserDownloadHost, JsonDownloadDescriptor, TextReadableFile } from "./types.js";

export async function readScenarioSourceFile(file: TextReadableFile): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error(`Could not parse '${file.name}' as JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export function createScenarioSourceDownload(source: ScenarioSource, filename = `${source.scenarioId}.json`): JsonDownloadDescriptor {
  return {
    filename,
    mime: "application/json",
    text: `${JSON.stringify(source, null, 2)}\n`,
  };
}

export function triggerJsonDownload(descriptor: JsonDownloadDescriptor, host: BrowserDownloadHost): void {
  const blob = new Blob([descriptor.text], { type: descriptor.mime });
  const url = host.createObjectUrl(blob);
  try {
    host.clickDownload(url, descriptor.filename);
  } finally {
    host.revokeObjectUrl(url);
  }
}

export function triggerBlobDownload(descriptor: BlobDownloadDescriptor, host: BrowserDownloadHost): void {
  const url = host.createObjectUrl(descriptor.blob);
  try {
    host.clickDownload(url, descriptor.filename);
  } finally {
    host.revokeObjectUrl(url);
  }
}
