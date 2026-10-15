import type { Plugin } from 'vite';

export interface LicenseEntry {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly text: string;
}

export function collectLicenses(root: string): LicenseEntry[];
export function licensesText(root: string): string;
export function thirdPartyLicenses(): Plugin;
