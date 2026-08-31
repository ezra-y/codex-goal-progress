export interface BuildPluginPackageOptions {
  readonly sourceRoot?: string;
  readonly outputRoot?: string;
}

export function buildPluginPackage(options?: BuildPluginPackageOptions): Promise<string>;
