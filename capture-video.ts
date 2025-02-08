import { composeVideo } from "./compose-video.ts";
import { downloadVideo } from "./download-video.ts";
import { findVideo } from "./find-urls.ts";
import { requireEnv } from "./require-env.ts";

if (import.meta.main) {
    const { storageRoot, ffmpegPath } = requireEnv()

    await main({
        args: Deno.args,
        storageRoot,
        ffmpegPath,
    })
}

type mainParams = {
    args: string[]
    storageRoot: string
    ffmpegPath: string
}
async function main({ args, storageRoot, ffmpegPath, }: mainParams) {
    if (args.length < 2) {
        console.log('usage: find-urls <folder> <url> [url ...]')
        return
    }

    const loginParams = requireEnv()
    const { cdnIdentifier } = loginParams

    const [folder, ...urls] = args
    const infoFiles = await findVideo({ folder, urls, storageRoot, loginParams, cdnIdentifier, })

    for (const jsonPath of infoFiles) {
        console.log(jsonPath)
        await downloadVideo({ jsonPath, storageRoot, })

        await composeVideo({
            jsonPath,
            teeLog: false,
            storageRoot,
            ffmpegPath,
        })
    }
}
