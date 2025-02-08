
export function requireEnv() {
    const ffmpegPath = Deno.env.get('FFmpeg_path')
    const storageRoot = Deno.env.get('Storage_root')
    console.log({
        ffmpegPath,
        storageRoot,
    })
    if (!ffmpegPath) {
        console.log('FFmpeg_path not set.')
        Deno.exit(1)
    }
    if (!storageRoot) {
        console.log('Storage_root not set.')
        Deno.exit(1)
    }
    return {
        ffmpegPath,
        storageRoot,
    }
}