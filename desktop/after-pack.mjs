import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import path from 'node:path';
export default async function afterPack(context) {
  await flipFuses(path.join(context.appOutDir, 'Slate.exe'), {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
}
