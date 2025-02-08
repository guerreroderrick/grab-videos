
export function getFileSafeName(name: string) {
    const safeName = name.replaceAll(/[/\\:*?"<>|]/g, '-')
    return safeName
}
export function getFFmpegSafeFolderName(name: string) {
    const fileSafeName = getFileSafeName(name)
    const safeName = fileSafeName.replaceAll(/[#]/g, '_')
    return safeName
}