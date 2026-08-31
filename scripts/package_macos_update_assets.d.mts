export const MACOS_UPDATE_ARCHIVE_NAME: "codex-goal-progress-macos-arm64.zip";
export const MACOS_UPDATE_ARCHIVE_ROOT: "codex-goal-progress-macos-arm64";

export interface PackageMacosUpdateAssetsOptions {
  readonly releaseRoot?: string;
  readonly outputRoot?: string;
  readonly version?: string;
}

export interface PackageMacosUpdateAssetsResult {
  readonly outputRoot: string;
  readonly archivePath: string;
  readonly archiveSha256: string;
}

export function packageMacosUpdateAssets(
  options?: PackageMacosUpdateAssetsOptions,
): Promise<PackageMacosUpdateAssetsResult>;
