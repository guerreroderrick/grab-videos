
export function requireEnv() {
    const ffmpegPath = Deno.env.get('FFmpeg_path')
    const storageRoot = Deno.env.get('Storage_root')

    const loginUrl = Deno.env.get('login_url')
    const loggedInSelector = Deno.env.get('logged_in_selector')
    const cdnIdentifier = Deno.env.get('cdn_identifier')

    console.log({
        ffmpegPath,
        storageRoot,
        loginUrl,
        loggedInSelector,
        cdnIdentifier,
    })
    if (!ffmpegPath) {
        console.log('FFmpeg_path not set.')
        Deno.exit(1)
    }
    if (!storageRoot) {
        console.log('Storage_root not set.')
        Deno.exit(1)
    }
    if (!loginUrl) {
        console.log('login_url not set.')
        Deno.exit(1)
    }
    if (!loggedInSelector) {
        console.log('logged_in_selector not set.')
        Deno.exit(1)
    }
    if (!cdnIdentifier) {
        console.log('cdn_identifier not set.')
        Deno.exit(1)
    }
    return {
        ffmpegPath,
        storageRoot,
        loginUrl,
        loggedInSelector,
        cdnIdentifier,
    }
}